//Viraj's Code Start

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	isValidLocalVariableName,
	type JsonSafeValue,
	type PersistedLocalState,
	toJsonSafeValue,
} from "./local-state.ts";

const REGISTRY_VERSION = 1;
const SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOT_NAME_LENGTH = 64;

export function formatCheckpointTimestamp(date: Date): string {
	const pad = (value: number, length = 2): string => String(value).padStart(length, "0");
	return [
		pad(date.getUTCFullYear(), 4),
		pad(date.getUTCMonth() + 1),
		pad(date.getUTCDate()),
		pad(date.getUTCHours()),
		pad(date.getUTCMinutes()),
		pad(date.getUTCSeconds()),
	].join("");
}

export interface NamedLocalStateSnapshot {
	version: 1;
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	sourceSessionId?: string;
	variables: Record<string, JsonSafeValue>;
	persistentNames: string[];
}

export interface NamedLocalStateSnapshotSummary {
	name: string;
	updatedAt: number;
	variableCount: number;
}

export interface SaveNamedLocalStateResult {
	snapshot: NamedLocalStateSnapshot;
	created: boolean;
}

interface NamedLocalStateRegistry {
	version: 1;
	snapshots: NamedLocalStateSnapshot[];
}

export function validateNamedLocalStateSnapshotName(name: string): void {
	if (name.length === 0) {
		throw new Error("Saved local-state session name must not be empty.");
	}
	if (name !== name.trim()) {
		throw new Error("Saved local-state session name must not have leading or trailing whitespace.");
	}
	if (name.length > MAX_SNAPSHOT_NAME_LENGTH) {
		throw new Error(`Saved local-state session name must be at most ${MAX_SNAPSHOT_NAME_LENGTH} characters.`);
	}
	if (name.includes("..") || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name)) {
		throw new Error(
			"Saved local-state session name must contain only letters, numbers, '.', '_', or '-', start and end with a letter or number, and must not contain '..'.",
		);
	}
}

function validateSnapshot(value: unknown): NamedLocalStateSnapshot {
	if (!value || typeof value !== "object") {
		throw new Error("Saved local-state snapshot is not an object.");
	}
	const snapshot = value as Record<string, unknown>;
	if (snapshot.version !== SNAPSHOT_VERSION) {
		throw new Error(`Unsupported saved local-state snapshot version: ${String(snapshot.version)}.`);
	}
	if (typeof snapshot.id !== "string" || snapshot.id.length === 0) {
		throw new Error("Saved local-state snapshot has an invalid id.");
	}
	if (typeof snapshot.name !== "string") {
		throw new Error("Saved local-state snapshot has an invalid name.");
	}
	validateNamedLocalStateSnapshotName(snapshot.name);
	if (
		typeof snapshot.createdAt !== "number" ||
		!Number.isFinite(snapshot.createdAt) ||
		typeof snapshot.updatedAt !== "number" ||
		!Number.isFinite(snapshot.updatedAt)
	) {
		throw new Error(`Saved local-state session "${snapshot.name}" has invalid timestamps.`);
	}
	if (snapshot.sourceSessionId !== undefined && typeof snapshot.sourceSessionId !== "string") {
		throw new Error(`Saved local-state session "${snapshot.name}" has an invalid source session id.`);
	}
	if (!snapshot.variables || typeof snapshot.variables !== "object" || Array.isArray(snapshot.variables)) {
		throw new Error(`Saved local-state session "${snapshot.name}" has invalid variables.`);
	}
	if (
		!Array.isArray(snapshot.persistentNames) ||
		!snapshot.persistentNames.every((name) => typeof name === "string")
	) {
		throw new Error(`Saved local-state session "${snapshot.name}" has invalid persistent variable names.`);
	}

	const variables = snapshot.variables as Record<string, unknown>;
	const persistentNames = [...new Set(snapshot.persistentNames as string[])];
	if (persistentNames.length !== snapshot.persistentNames.length) {
		throw new Error(`Saved local-state session "${snapshot.name}" has duplicate persistent variable names.`);
	}
	const validatedVariables: Record<string, JsonSafeValue> = {};
	for (const name of persistentNames) {
		if (!isValidLocalVariableName(name) || !Object.hasOwn(variables, name)) {
			throw new Error(`Saved local-state session "${snapshot.name}" has an invalid variable named "${name}".`);
		}
		validatedVariables[name] = toJsonSafeValue(variables[name], name);
	}
	if (Object.keys(variables).length !== persistentNames.length) {
		throw new Error(`Saved local-state session "${snapshot.name}" contains unmarked variables.`);
	}

	return {
		version: SNAPSHOT_VERSION,
		id: snapshot.id,
		name: snapshot.name,
		createdAt: snapshot.createdAt,
		updatedAt: snapshot.updatedAt,
		sourceSessionId: snapshot.sourceSessionId as string | undefined,
		variables: validatedVariables,
		persistentNames,
	};
}

export class NamedLocalStateStore {
	private readonly storageDirectory: string;
	private readonly registryPath: string;

	constructor(storageDirectory: string) {
		this.storageDirectory = storageDirectory;
		this.registryPath = storageDirectory ? join(storageDirectory, "registry.json") : "";
	}

	save(name: string | undefined, state: PersistedLocalState, sourceSessionId?: string): SaveNamedLocalStateResult {
		if (state.persistentNames.length === 0) {
			throw new Error("No persisted variables are available to save.");
		}
		const registry = this.readRegistry();
		const resolvedName = name === undefined ? this.generateName(registry) : name;
		validateNamedLocalStateSnapshotName(resolvedName);

		const variables: Record<string, JsonSafeValue> = {};
		for (const variableName of state.persistentNames) {
			if (!isValidLocalVariableName(variableName) || !Object.hasOwn(state.variables, variableName)) {
				throw new Error(`Invalid persisted variable "${variableName}".`);
			}
			variables[variableName] = toJsonSafeValue(state.variables[variableName], variableName);
		}

		const existingIndex = registry.snapshots.findIndex((snapshot) => snapshot.name === resolvedName);
		const now = Date.now();
		const existing = existingIndex === -1 ? undefined : registry.snapshots[existingIndex];
		const snapshot: NamedLocalStateSnapshot = {
			version: SNAPSHOT_VERSION,
			id: existing?.id ?? randomUUID(),
			name: resolvedName,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			sourceSessionId,
			variables,
			persistentNames: [...state.persistentNames],
		};
		if (existingIndex === -1) {
			registry.snapshots.push(snapshot);
		} else {
			registry.snapshots[existingIndex] = snapshot;
		}
		this.writeRegistry(registry);
		return { snapshot, created: existingIndex === -1 };
	}

	get(name: string): NamedLocalStateSnapshot | undefined {
		validateNamedLocalStateSnapshotName(name);
		return this.readRegistry().snapshots.find((snapshot) => snapshot.name === name);
	}

	list(): NamedLocalStateSnapshotSummary[] {
		return this.readRegistry()
			.snapshots.map((snapshot) => ({
				name: snapshot.name,
				updatedAt: snapshot.updatedAt,
				variableCount: snapshot.persistentNames.length,
			}))
			.sort((left, right) => left.name.localeCompare(right.name));
	}

	delete(name: string): boolean {
		validateNamedLocalStateSnapshotName(name);
		const registry = this.readRegistry();
		const nextSnapshots = registry.snapshots.filter((snapshot) => snapshot.name !== name);
		if (nextSnapshots.length === registry.snapshots.length) {
			return false;
		}
		this.writeRegistry({ version: REGISTRY_VERSION, snapshots: nextSnapshots });
		return true;
	}

	private generateName(registry: NamedLocalStateRegistry): string {
		const timestamp = formatCheckpointTimestamp(new Date());
		for (let attempt = 0; ; attempt++) {
			const candidate = attempt === 0 ? timestamp : `${timestamp}-${String(attempt).padStart(2, "0")}`;
			if (!registry.snapshots.some((snapshot) => snapshot.name === candidate)) {
				return candidate;
			}
		}
	}

	private readRegistry(): NamedLocalStateRegistry {
		if (!this.registryPath) {
			throw new Error("Named local-state sessions require durable session storage.");
		}
		if (!existsSync(this.registryPath)) {
			return { version: REGISTRY_VERSION, snapshots: [] };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(this.registryPath, "utf8"));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to read saved local-state sessions: ${message}`);
		}
		if (!parsed || typeof parsed !== "object") {
			throw new Error("Saved local-state session registry is not an object.");
		}
		const registry = parsed as Record<string, unknown>;
		if (registry.version !== REGISTRY_VERSION) {
			throw new Error(`Unsupported saved local-state registry version: ${String(registry.version)}.`);
		}
		if (!Array.isArray(registry.snapshots)) {
			throw new Error("Saved local-state session registry has invalid snapshots.");
		}
		const snapshots = registry.snapshots.map((snapshot) => validateSnapshot(snapshot));
		if (new Set(snapshots.map((snapshot) => snapshot.name)).size !== snapshots.length) {
			throw new Error("Saved local-state session registry contains duplicate names.");
		}
		return { version: REGISTRY_VERSION, snapshots };
	}

	private writeRegistry(registry: NamedLocalStateRegistry): void {
		if (!this.registryPath) {
			throw new Error("Named local-state sessions require durable session storage.");
		}
		mkdirSync(this.storageDirectory, { recursive: true, mode: 0o700 });
		const temporaryPath = join(this.storageDirectory, `.registry-${randomUUID()}.tmp`);
		try {
			writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
				encoding: "utf8",
				flag: "wx",
				mode: 0o600,
			});
			renameSync(temporaryPath, this.registryPath);
		} catch (error) {
			if (existsSync(temporaryPath)) {
				rmSync(temporaryPath);
			}
			throw error;
		}
	}
}
//Viraj's Code End
