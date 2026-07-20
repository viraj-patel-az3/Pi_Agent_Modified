//Viraj's code start
export class FocusedExpressionUnsupportedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FocusedExpressionUnsupportedError";
	}
}

export class FocusedExpressionSyntaxError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FocusedExpressionSyntaxError";
	}
}

type TokenKind =
	| "number"
	| "identifier"
	| "leftParen"
	| "rightParen"
	| "comma"
	| "plus"
	| "minus"
	| "percent"
	| "range"
	| "eof";

interface Token {
	kind: TokenKind;
	text: string;
	position: number;
	value?: number;
}

export type FocusedExpressionNode =
	| { type: "number"; value: number }
	| { type: "unary"; operator: "+" | "-"; operand: FocusedExpressionNode }
	| { type: "percent"; operand: FocusedExpressionNode }
	| { type: "range"; start: FocusedExpressionNode; end: FocusedExpressionNode }
	| { type: "call"; name: string; args: FocusedExpressionNode[] };

type TokenizeResult = { kind: "tokens"; tokens: Token[] } | { kind: "unsupported"; message: string; position: number };

type ParseResult = { kind: "parsed"; node: FocusedExpressionNode } | { kind: "unsupported"; message: string };

type NumericLike = number | number[];
type EvaluatedValue = number | number[] | number[][];

const MAX_RANGE_SIZE = 10000;

class Parser {
	private _index = 0;
	private readonly _tokens: Token[];

	constructor(tokens: Token[]) {
		this._tokens = tokens;
	}

	parse(): ParseResult {
		const expression = this._parseExpression();
		if (expression.kind === "unsupported") {
			return expression;
		}

		const trailing = this._peek();
		if (trailing.kind !== "eof") {
			throw new FocusedExpressionSyntaxError(
				`Unexpected token "${trailing.text}" at position ${trailing.position + 1}`,
			);
		}

		return { kind: "parsed", node: expression.node };
	}

	private _parseExpression(): ParseResult {
		return this._parseRange();
	}

	private _parseRange(): ParseResult {
		const left = this._parsePostfix();
		if (left.kind === "unsupported") {
			return left;
		}

		if (!this._match("range")) {
			return left;
		}

		const right = this._parsePostfix();
		if (right.kind === "unsupported") {
			throw new FocusedExpressionSyntaxError("Expected a range end expression");
		}

		return {
			kind: "parsed",
			node: {
				type: "range",
				start: left.node,
				end: right.node,
			},
		};
	}

	private _parsePostfix(): ParseResult {
		const base = this._parseUnary();
		if (base.kind === "unsupported") {
			return base;
		}

		let node = base.node;
		if (this._match("percent")) {
			node = { type: "percent", operand: node };
			if (this._check("percent")) {
				const token = this._peek();
				throw new FocusedExpressionSyntaxError(
					`Unexpected token "${token.text}" at position ${token.position + 1}`,
				);
			}
		}
		return { kind: "parsed", node };
	}

	private _parseUnary(): ParseResult {
		if (this._match("plus")) {
			const operand = this._parseUnary();
			if (operand.kind === "unsupported") {
				throw new FocusedExpressionSyntaxError('Expected an expression after unary "+"');
			}
			return { kind: "parsed", node: { type: "unary", operator: "+", operand: operand.node } };
		}

		if (this._match("minus")) {
			const operand = this._parseUnary();
			if (operand.kind === "unsupported") {
				throw new FocusedExpressionSyntaxError('Expected an expression after unary "-"');
			}
			return { kind: "parsed", node: { type: "unary", operator: "-", operand: operand.node } };
		}

		return this._parsePrimary();
	}

	private _parsePrimary(): ParseResult {
		const token = this._peek();
		if (token.kind === "number") {
			this._advance();
			return { kind: "parsed", node: { type: "number", value: token.value ?? 0 } };
		}

		if (token.kind === "identifier") {
			this._advance();
			if (!this._match("leftParen")) {
				return {
					kind: "unsupported",
					message: `Bare identifier "${token.text}" is outside the focused evaluator grammar`,
				};
			}

			const args: FocusedExpressionNode[] = [];
			if (!this._check("rightParen")) {
				while (true) {
					const argument = this._parseExpression();
					if (argument.kind === "unsupported") {
						throw new FocusedExpressionSyntaxError(`Unsupported argument in call to "${token.text}"`);
					}
					args.push(argument.node);
					if (!this._match("comma")) {
						break;
					}
				}
			}
			this._consume("rightParen", `Expected ")" after arguments to "${token.text}"`);
			return { kind: "parsed", node: { type: "call", name: token.text, args } };
		}

		if (this._match("leftParen")) {
			const inner = this._parseExpression();
			if (inner.kind === "unsupported") {
				throw new FocusedExpressionSyntaxError('Expected an expression after "("');
			}
			this._consume("rightParen", 'Expected ")" after grouped expression');
			return inner;
		}

		if (token.kind === "eof") {
			return { kind: "unsupported", message: "Empty expressions are outside the focused evaluator grammar" };
		}

		throw new FocusedExpressionSyntaxError(`Unexpected token "${token.text}" at position ${token.position + 1}`);
	}

	private _peek(): Token {
		return this._tokens[this._index];
	}

	private _advance(): Token {
		const token = this._tokens[this._index];
		this._index += 1;
		return token;
	}

	private _match(kind: TokenKind): boolean {
		if (!this._check(kind)) {
			return false;
		}
		this._index += 1;
		return true;
	}

	private _check(kind: TokenKind): boolean {
		return this._peek().kind === kind;
	}

	private _consume(kind: TokenKind, message: string): Token {
		if (!this._check(kind)) {
			throw new FocusedExpressionSyntaxError(message);
		}
		return this._advance();
	}
}

function tokenize(expression: string): TokenizeResult {
	const tokens: Token[] = [];
	let index = 0;

	while (index < expression.length) {
		const char = expression[index];

		if (/\s/.test(char)) {
			index += 1;
			continue;
		}

		if (char === "(") {
			tokens.push({ kind: "leftParen", text: char, position: index });
			index += 1;
			continue;
		}

		if (char === ")") {
			tokens.push({ kind: "rightParen", text: char, position: index });
			index += 1;
			continue;
		}

		if (char === ",") {
			tokens.push({ kind: "comma", text: char, position: index });
			index += 1;
			continue;
		}

		if (char === "+") {
			tokens.push({ kind: "plus", text: char, position: index });
			index += 1;
			continue;
		}

		if (char === "-") {
			tokens.push({ kind: "minus", text: char, position: index });
			index += 1;
			continue;
		}

		if (char === "%") {
			tokens.push({ kind: "percent", text: char, position: index });
			index += 1;
			continue;
		}

		if (char === "." && expression[index + 1] === ".") {
			tokens.push({ kind: "range", text: "..", position: index });
			index += 2;
			continue;
		}

		if (/\d/.test(char)) {
			const start = index;
			while (index < expression.length && /\d/.test(expression[index])) {
				index += 1;
			}

			if (expression[index] === "." && expression[index + 1] !== "." && /\d/.test(expression[index + 1] ?? "")) {
				index += 1;
				while (index < expression.length && /\d/.test(expression[index])) {
					index += 1;
				}
			}

			const text = expression.slice(start, index);
			tokens.push({ kind: "number", text, position: start, value: Number(text) });
			continue;
		}

		if (/[A-Za-z_]/.test(char)) {
			const start = index;
			index += 1;
			while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index])) {
				index += 1;
			}
			const text = expression.slice(start, index);
			tokens.push({ kind: "identifier", text, position: start });
			continue;
		}

		return {
			kind: "unsupported",
			message: `Unsupported character "${char}" at position ${index + 1}`,
			position: index,
		};
	}

	tokens.push({ kind: "eof", text: "", position: expression.length });
	return { kind: "tokens", tokens };
}

function hasFocusedSyntaxHint(expression: string): boolean {
	return /%|\.\.|(^|[^A-Za-z0-9_])(sin|pmt)\s*\(|(^|[^A-Za-z0-9_])[A-Z_][A-Z0-9_]*\s*\(/.test(expression);
}

function ensureFiniteNumber(value: number, name: string): number {
	if (!Number.isFinite(value)) {
		throw new FocusedExpressionSyntaxError(`${name} must be a finite number`);
	}
	return value;
}

function isNumberArray(value: NumericLike): value is number[] {
	return Array.isArray(value);
}

function isNumberMatrix(value: EvaluatedValue): value is number[][] {
	return Array.isArray(value) && value.every((item) => Array.isArray(item));
}

function expectScalarNumber(value: EvaluatedValue, name: string): number {
	if (Array.isArray(value)) {
		throw new FocusedExpressionSyntaxError(`${name} must be a scalar number`);
	}
	return ensureFiniteNumber(value, name);
}

function evaluateRange(startValue: NumericLike, endValue: NumericLike): number[] {
	const start = expectScalarNumber(startValue, "Range start");
	const end = expectScalarNumber(endValue, "Range end");

	if (!Number.isInteger(start) || !Number.isInteger(end)) {
		throw new FocusedExpressionSyntaxError("Range endpoints must be finite integers");
	}

	const step = start <= end ? 1 : -1;
	const size = Math.abs(end - start) + 1;
	if (size > MAX_RANGE_SIZE) {
		throw new FocusedExpressionSyntaxError(
			`Range size ${size} exceeds the local evaluation limit of ${MAX_RANGE_SIZE}`,
		);
	}

	const values: number[] = [];
	for (let current = start; step > 0 ? current <= end : current >= end; current += step) {
		values.push(current);
	}
	return values;
}

function vectorize(
	args: NumericLike[],
	mapScalar: (...values: number[]) => number,
	outputMode: "flat" | "columnMatrix",
): NumericLike | number[][] {
	const arrayLengths = args.filter(isNumberArray).map((value) => value.length);
	if (arrayLengths.length === 0) {
		return mapScalar(...args.map((value, index) => expectScalarNumber(value, `Argument ${index + 1}`)));
	}

	const targetLength = arrayLengths[0];
	if (arrayLengths.some((length) => length !== targetLength)) {
		throw new FocusedExpressionSyntaxError("Vectorized arguments must have the same length");
	}

	const results = Array.from({ length: targetLength }, (_item, index) =>
		mapScalar(
			...args.map((value, argIndex) =>
				expectScalarNumber(isNumberArray(value) ? value[index] : value, `Argument ${argIndex + 1}`),
			),
		),
	);

	if (outputMode === "columnMatrix") {
		return results.map((value) => [value]);
	}
	return results;
}

function evaluateSin(args: NumericLike[]): NumericLike {
	if (args.length !== 1) {
		throw new FocusedExpressionSyntaxError("SIN expects exactly 1 argument");
	}
	return vectorize(args, (value) => Math.sin(value), "flat") as NumericLike;
}

function calculatePmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
	ensureFiniteNumber(rate, "rate");
	ensureFiniteNumber(nper, "nper");
	ensureFiniteNumber(pv, "pv");
	ensureFiniteNumber(fv, "fv");
	ensureFiniteNumber(type, "type");

	if (nper === 0) {
		throw new FocusedExpressionSyntaxError("nper cannot be zero");
	}
	if (type !== 0 && type !== 1) {
		throw new FocusedExpressionSyntaxError("type must be 0 or 1");
	}

	if (rate === 0) {
		return -(pv + fv) / nper;
	}

	const growth = (1 + rate) ** nper;
	const denominator = (1 + rate * type) * (growth - 1);
	if (denominator === 0) {
		throw new FocusedExpressionSyntaxError("PMT produced an invalid zero denominator");
	}

	return -(rate * (fv + pv * growth)) / denominator;
}

function evaluatePmt(args: NumericLike[]): NumericLike | number[][] {
	if (args.length < 3 || args.length > 5) {
		throw new FocusedExpressionSyntaxError("PMT expects between 3 and 5 arguments");
	}

	const rate = args[0];
	const nper = args[1];
	const pv = args[2];
	const fv = args[3] ?? 0;
	const type = args[4] ?? 0;

	return vectorize([rate, nper, pv, fv, type], calculatePmt, "columnMatrix");
}

export function parseFocusedExpression(expression: string): FocusedExpressionNode {
	const tokenized = tokenize(expression);
	if (tokenized.kind === "unsupported") {
		throw new FocusedExpressionUnsupportedError(tokenized.message);
	}

	const parser = new Parser(tokenized.tokens);
	const parsed = parser.parse();
	if (parsed.kind === "unsupported") {
		throw new FocusedExpressionUnsupportedError(parsed.message);
	}

	return parsed.node;
}

export function evaluateFocusedExpressionNode(node: FocusedExpressionNode): EvaluatedValue {
	switch (node.type) {
		case "number":
			return node.value;
		case "unary": {
			const operand = expectScalarNumber(evaluateFocusedExpressionNode(node.operand), "Unary operand");
			return node.operator === "-" ? -operand : operand;
		}
		case "percent": {
			const operand = expectScalarNumber(evaluateFocusedExpressionNode(node.operand), "Percent operand");
			return operand / 100;
		}
		case "range": {
			const start = evaluateFocusedExpressionNode(node.start);
			const end = evaluateFocusedExpressionNode(node.end);
			if (isNumberMatrix(start) || isNumberMatrix(end)) {
				throw new FocusedExpressionSyntaxError("Range endpoints cannot be matrix values");
			}
			return evaluateRange(start, end);
		}
		case "call": {
			const args = node.args.map((arg) => evaluateFocusedExpressionNode(arg));
			const upperName = node.name.toUpperCase();
			if (upperName === "SIN") {
				if (args.some((arg) => isNumberMatrix(arg))) {
					throw new FocusedExpressionSyntaxError("SIN does not support nested matrix arguments");
				}
				return evaluateSin(args as NumericLike[]);
			}
			if (upperName === "PMT") {
				if (args.some((arg) => isNumberMatrix(arg))) {
					throw new FocusedExpressionSyntaxError("PMT does not support nested matrix arguments");
				}
				return evaluatePmt(args as NumericLike[]);
			}
			throw new FocusedExpressionSyntaxError(`Unsupported function "${node.name}"`);
		}
	}
}

export function tryEvaluateFocusedExpression(
	expression: string,
): { kind: "unsupported" } | { kind: "value"; value: EvaluatedValue } {
	try {
		return { kind: "value", value: evaluateFocusedExpressionNode(parseFocusedExpression(expression)) };
	} catch (error) {
		if (error instanceof FocusedExpressionUnsupportedError) {
			if (hasFocusedSyntaxHint(expression)) {
				throw new FocusedExpressionSyntaxError(error.message);
			}
			return { kind: "unsupported" };
		}
		if (error instanceof FocusedExpressionSyntaxError && !hasFocusedSyntaxHint(expression)) {
			return { kind: "unsupported" };
		}
		throw error;
	}
}
//Viraj's code end
