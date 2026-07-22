//Viraj's Code Start
import ts from "typescript";

export type JsonSafeValue = null | boolean | number | string | JsonSafeValue[] | { [key: string]: JsonSafeValue };

export interface PersistedLocalState {
	version: 1;
	variables: Record<string, JsonSafeValue>;
	persistentNames: string[];
}

export interface LocalVariableAssignment {
	name: string;
	expression: string;
}

interface ParsedSourceFile extends ts.SourceFile {
	parseDiagnostics: readonly ts.Diagnostic[];
}

export class LocalStateSerializationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LocalStateSerializationError";
	}
}

export function isValidLocalVariableName(name: string): boolean {
	if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
		return false;
	}
	try {
		Function(name, '"use strict";');
		return true;
	} catch {
		return false;
	}
}

function serializationError(name: string, reason: string): LocalStateSerializationError {
	return new LocalStateSerializationError(`Cannot persist "${name}": ${reason}.`);
}

export function toJsonSafeValue(value: unknown, name: string): JsonSafeValue {
	const ancestors = new WeakSet<object>();

	const visit = (current: unknown): JsonSafeValue => {
		if (current === null || typeof current === "string" || typeof current === "boolean") {
			return current;
		}
		if (typeof current === "number") {
			if (!Number.isFinite(current)) {
				throw serializationError(name, "non-finite numbers are not supported");
			}
			return current;
		}
		if (typeof current === "function") {
			throw serializationError(name, "functions are not supported");
		}
		if (typeof current === "undefined") {
			throw serializationError(name, "undefined is not supported");
		}
		if (typeof current === "symbol") {
			throw serializationError(name, "symbols are not supported");
		}
		if (typeof current === "bigint") {
			throw serializationError(name, "bigints are not supported");
		}

		if (ancestors.has(current)) {
			throw serializationError(name, "circular values are not supported");
		}
		ancestors.add(current);
		try {
			if (Array.isArray(current)) {
				return current.map((item) => visit(item));
			}
			const prototype = Object.getPrototypeOf(current);
			if (prototype !== Object.prototype && prototype !== null) {
				throw serializationError(name, "objects with custom prototypes are not supported");
			}
			const result: Record<string, JsonSafeValue> = {};
			for (const [key, entryValue] of Object.entries(current)) {
				result[key] = visit(entryValue);
			}
			return result;
		} finally {
			ancestors.delete(current);
		}
	};

	return visit(value);
}

export function parseLocalVariableAssignment(source: string): LocalVariableAssignment | undefined {
	const sourceFile = ts.createSourceFile(
		"local-state-assignment.js",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	) as ParsedSourceFile;
	if (sourceFile.parseDiagnostics.length > 0) {
		return undefined;
	}
	if (sourceFile.statements.length !== 1) {
		return undefined;
	}
	const statement = sourceFile.statements[0];
	if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
		return undefined;
	}
	const assignment = statement.expression;
	if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(assignment.left)) {
		return undefined;
	}
	return {
		name: assignment.left.text,
		expression: assignment.right.getText(sourceFile),
	};
}

export function referencesLocalVariable(source: string, names: ReadonlySet<string>): boolean {
	if (names.size === 0) {
		return false;
	}
	const sourceFile = ts.createSourceFile(
		"local-state-expression.js",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	) as ParsedSourceFile;
	if (sourceFile.parseDiagnostics.length > 0 || sourceFile.statements.length !== 1) {
		return false;
	}
	const statement = sourceFile.statements[0];
	if (!ts.isExpressionStatement(statement)) {
		return false;
	}

	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isIdentifier(node) && names.has(node.text)) {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(statement.expression);
	return found;
}

export class LocalStateStore {
	private readonly variables = new Map<string, unknown>();
	private readonly persistentNames = new Set<string>();

	constructor(state?: PersistedLocalState) {
		if (!state || state.version !== 1) {
			return;
		}
		for (const name of state.persistentNames) {
			if (isValidLocalVariableName(name) && Object.hasOwn(state.variables, name)) {
				this.variables.set(name, state.variables[name]);
				this.persistentNames.add(name);
			}
		}
	}

	has(name: string): boolean {
		return this.variables.has(name);
	}

	get(name: string): unknown {
		return this.variables.get(name);
	}

	set(name: string, value: unknown): void {
		this.variables.set(name, value);
	}

	entries(): Array<[string, unknown]> {
		return [...this.variables.entries()];
	}

	clone(): LocalStateStore {
		const copy = new LocalStateStore();
		for (const [name, value] of this.variables) {
			copy.variables.set(name, value);
		}
		for (const name of this.persistentNames) {
			copy.persistentNames.add(name);
		}
		return copy;
	}

	mergePersistedState(state: PersistedLocalState): void {
		if (state.version !== 1) {
			throw new Error(`Unsupported persisted local-state version: ${String(state.version)}.`);
		}
		const validated = new Map<string, JsonSafeValue>();
		for (const name of state.persistentNames) {
			if (!isValidLocalVariableName(name) || !Object.hasOwn(state.variables, name)) {
				throw new Error(`Invalid persisted variable "${name}".`);
			}
			validated.set(name, toJsonSafeValue(state.variables[name], name));
		}
		for (const [name, value] of validated) {
			this.variables.set(name, value);
			this.persistentNames.add(name);
		}
	}

	replaceWith(state: LocalStateStore): void {
		this.variables.clear();
		this.persistentNames.clear();
		for (const [name, value] of state.variables) {
			this.variables.set(name, value);
		}
		for (const name of state.persistentNames) {
			this.persistentNames.add(name);
		}
	}

	markPersistent(names: string[]): void {
		for (const name of names) {
			this.persistentNames.add(name);
		}
	}

	unmarkPersistent(names: string[]): void {
		for (const name of names) {
			this.persistentNames.delete(name);
		}
	}

	isPersistent(name: string): boolean {
		return this.persistentNames.has(name);
	}

	clearPersistence(): void {
		this.persistentNames.clear();
	}

	createPersistedState(overrides?: ReadonlyMap<string, JsonSafeValue>): PersistedLocalState {
		const variables: Record<string, JsonSafeValue> = {};
		for (const name of this.persistentNames) {
			variables[name] = overrides?.get(name) ?? toJsonSafeValue(this.variables.get(name), name);
		}
		return { version: 1, variables, persistentNames: [...this.persistentNames] };
	}
}
//Viraj's Code End
