//Viraj's Code Start
import ts from "typescript";

export type LocalEvalFileType = "js" | "z3";

export type LocalEvalFileExecutionBlock =
	| { kind: "expression"; expression: string }
	| { kind: "prompt"; prompts: string[] };

export class PromptExecutionBlockError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PromptExecutionBlockError";
	}
}

interface ParsedSourceFile extends ts.SourceFile {
	parseDiagnostics: readonly ts.Diagnostic[];
}

export function getLocalEvalFileType(filePath: string): LocalEvalFileType | undefined {
	const lowerPath = filePath.toLowerCase();
	if (lowerPath.endsWith(".js")) {
		return "js";
	}
	if (lowerPath.endsWith(".z3")) {
		return "z3";
	}
	return undefined;
}

interface BraceScanState {
	braceDepth: number;
	inSingleQuote: boolean;
	inDoubleQuote: boolean;
	inTemplateQuote: boolean;
	inBlockComment: boolean;
	escaping: boolean;
}

function createBraceScanState(): BraceScanState {
	return {
		braceDepth: 0,
		inSingleQuote: false,
		inDoubleQuote: false,
		inTemplateQuote: false,
		inBlockComment: false,
		escaping: false,
	};
}

function scanLineForBraceDepth(line: string, state: BraceScanState): void {
	for (let index = 0; index < line.length; index++) {
		const char = line[index];
		const next = line[index + 1];

		if (state.inBlockComment) {
			if (char === "*" && next === "/") {
				state.inBlockComment = false;
				index += 1;
			}
			continue;
		}

		if (state.inSingleQuote) {
			if (state.escaping) {
				state.escaping = false;
				continue;
			}
			if (char === "\\") {
				state.escaping = true;
				continue;
			}
			if (char === "'") {
				state.inSingleQuote = false;
			}
			continue;
		}

		if (state.inDoubleQuote) {
			if (state.escaping) {
				state.escaping = false;
				continue;
			}
			if (char === "\\") {
				state.escaping = true;
				continue;
			}
			if (char === '"') {
				state.inDoubleQuote = false;
			}
			continue;
		}

		if (state.inTemplateQuote) {
			if (state.escaping) {
				state.escaping = false;
				continue;
			}
			if (char === "\\") {
				state.escaping = true;
				continue;
			}
			if (char === "`") {
				state.inTemplateQuote = false;
			}
			continue;
		}

		if (char === "/" && next === "/") {
			break;
		}

		if (char === "/" && next === "*") {
			state.inBlockComment = true;
			index += 1;
			continue;
		}

		if (char === "'") {
			state.inSingleQuote = true;
			continue;
		}

		if (char === '"') {
			state.inDoubleQuote = true;
			continue;
		}

		if (char === "`") {
			state.inTemplateQuote = true;
			continue;
		}

		if (char === "{") {
			state.braceDepth += 1;
			continue;
		}

		if (char === "}" && state.braceDepth > 0) {
			state.braceDepth -= 1;
		}
	}
}

function shouldSkipStandaloneLine(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.length === 0 || trimmed === ";" || trimmed.startsWith("#") || trimmed.startsWith("//");
}

export function splitLocalEvalFileBlocks(content: string): string[] {
	const blocks: string[] = [];
	const lines = content.split("\n");
	let pendingLines: string[] = [];
	let pendingState = createBraceScanState();

	const flushPendingLines = () => {
		const block = pendingLines.join("\n").trim();
		if (block.length > 0) {
			blocks.push(block);
		}
		pendingLines = [];
		pendingState = createBraceScanState();
	};

	for (const line of lines) {
		if (pendingLines.length === 0 && shouldSkipStandaloneLine(line)) {
			continue;
		}

		pendingLines.push(line);
		scanLineForBraceDepth(line, pendingState);

		const isBalanced =
			pendingState.braceDepth === 0 &&
			!pendingState.inSingleQuote &&
			!pendingState.inDoubleQuote &&
			!pendingState.inTemplateQuote &&
			!pendingState.inBlockComment;
		if (isBalanced) {
			flushPendingLines();
		}
	}

	if (pendingLines.length > 0) {
		flushPendingLines();
	}

	return blocks;
}

function isPossiblePromptExecutionBlock(source: string): boolean {
	return /^\s*prompt\s*=/.test(source);
}

function getPropertyName(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return undefined;
}

function getStringLiteralValue(expression: ts.Expression): string | undefined {
	if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
		return expression.text.trim();
	}
	return undefined;
}

function parsePromptValue(expression: ts.Expression): string[] {
	const singlePrompt = getStringLiteralValue(expression);
	if (singlePrompt !== undefined) {
		if (singlePrompt.length === 0) {
			throw new PromptExecutionBlockError("Prompt block prompt entries must not be empty.");
		}
		return [singlePrompt];
	}

	if (!ts.isArrayLiteralExpression(expression)) {
		throw new PromptExecutionBlockError('Prompt block "prompt" property must be a string or array of strings.');
	}

	return expression.elements.map((element, index) => {
		if (!ts.isExpression(element)) {
			throw new PromptExecutionBlockError(`Prompt block prompt entry ${index + 1} must be a string.`);
		}
		const value = getStringLiteralValue(element);
		if (value === undefined) {
			throw new PromptExecutionBlockError(`Prompt block prompt entry ${index + 1} must be a string.`);
		}
		if (value.length === 0) {
			throw new PromptExecutionBlockError(`Prompt block prompt entry ${index + 1} must not be empty.`);
		}
		return value;
	});
}

export function parseLocalEvalFileBlock(source: string): LocalEvalFileExecutionBlock {
	const expression = source.trim().replace(/;\s*$/, "").trim();
	if (!isPossiblePromptExecutionBlock(expression)) {
		return { kind: "expression", expression };
	}

	const sourceFile = ts.createSourceFile(
		"local-eval-file-block.js",
		expression,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	) as ParsedSourceFile;
	if (sourceFile.parseDiagnostics.length > 0) {
		const diagnostic = sourceFile.parseDiagnostics[0];
		const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
		throw new PromptExecutionBlockError(`Invalid prompt block syntax: ${message}`);
	}
	if (sourceFile.statements.length !== 1) {
		throw new PromptExecutionBlockError("Prompt block must contain a single prompt assignment.");
	}

	const statement = sourceFile.statements[0];
	if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
		return { kind: "expression", expression };
	}

	const assignment = statement.expression;
	if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
		return { kind: "expression", expression };
	}
	if (!ts.isIdentifier(assignment.left) || assignment.left.text !== "prompt") {
		return { kind: "expression", expression };
	}
	if (!ts.isObjectLiteralExpression(assignment.right)) {
		throw new PromptExecutionBlockError("Prompt block must assign an object.");
	}

	const promptProperty = assignment.right.properties.find(
		(property): property is ts.PropertyAssignment =>
			ts.isPropertyAssignment(property) && getPropertyName(property.name) === "prompt",
	);
	if (!promptProperty) {
		throw new PromptExecutionBlockError('Prompt block must contain a "prompt" property.');
	}

	return { kind: "prompt", prompts: parsePromptValue(promptProperty.initializer) };
}
//Viraj's Code end
