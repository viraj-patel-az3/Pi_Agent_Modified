//Viraj's Code Start

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	isValidLocalVariableName,
	type JsonSafeValue,
	type PersistedLocalState,
	toJsonSafeValue,
} from "./local-state.ts";
import {
	formatCheckpointTimestamp,
	type NamedLocalStateSnapshot,
	type NamedLocalStateSnapshotSummary,
	NamedLocalStateStore,
	type SaveNamedLocalStateResult,
	validateNamedLocalStateSnapshotName,
} from "./named-local-state-store.ts";

const SCHEMA_VERSION = 1;
const SESSION_STATE_VERSION = 1;
const SNAPSHOT_VERSION = 1;
const LEGACY_MIGRATION_FLAG = "legacy_named_checkpoints_migrated";

interface NamedCheckpointRow {
	id: string;
	name: string;
	version: number;
	created_at: number;
	updated_at: number;
	source_session_id: string | null;
	variables_json: string;
	persistent_names_json: string;
}

export class SQLiteLocalStateStore {
	private readonly db: DatabaseSync;
	private readonly sessionDirectory: string;

	constructor(sessionDirectory: string) {
		if (!sessionDirectory) {
			throw new Error("SQLiteLocalStateStore requires a durable session directory.");
		}
		this.sessionDirectory = sessionDirectory;
		mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
		this.db = new DatabaseSync(join(sessionDirectory, "agentz-local-state.sqlite"));
		this.db.exec("PRAGMA journal_mode = WAL");
		this.initSchema();
		this.migrateLegacyNamedCheckpoints();
	}

	private initSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS schema_metadata (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS session_local_state (
				session_id TEXT PRIMARY KEY,
				version INTEGER NOT NULL,
				variables_json TEXT NOT NULL,
				persistent_names_json TEXT NOT NULL,
				updated_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS named_checkpoints (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				version INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				source_session_id TEXT,
				variables_json TEXT NOT NULL,
				persistent_names_json TEXT NOT NULL
			);
		`);

		const existing = this.getMetadata("schema_version");
		if (existing === undefined) {
			this.setMetadata("schema_version", String(SCHEMA_VERSION));
		} else if (existing !== String(SCHEMA_VERSION)) {
			throw new Error(`Unsupported agentz-local-state schema version: ${existing}.`);
		}
	}

	private getMetadata(key: string): string | undefined {
		const row = this.db.prepare("SELECT value FROM schema_metadata WHERE key = ?").get(key) as
			| { value: string }
			| undefined;
		return row?.value;
	}

	private setMetadata(key: string, value: string): void {
		this.db
			.prepare(
				"INSERT INTO schema_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			)
			.run(key, value);
	}

	private withTransaction<T>(work: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = work();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	private migrateLegacyNamedCheckpoints(): void {
		if (this.getMetadata(LEGACY_MIGRATION_FLAG) === "1") {
			return;
		}
		const legacyDirectory = join(this.sessionDirectory, "named-local-state");
		const legacyRegistryPath = join(legacyDirectory, "registry.json");
		if (existsSync(legacyRegistryPath)) {
			try {
				const legacyStore = new NamedLocalStateStore(legacyDirectory);
				for (const summary of legacyStore.list()) {
					if (this.findCheckpointRow(summary.name)) {
						continue;
					}
					const snapshot = legacyStore.get(summary.name);
					if (!snapshot) {
						continue;
					}
					this.insertCheckpointRow(snapshot);
				}
			} catch {
				// Leave the legacy registry untouched; migration is retried on next init.
				return;
			}
		}
		this.setMetadata(LEGACY_MIGRATION_FLAG, "1");
	}

	private findCheckpointRow(name: string): NamedCheckpointRow | undefined {
		return this.db.prepare("SELECT * FROM named_checkpoints WHERE name = ?").get(name) as
			| NamedCheckpointRow
			| undefined;
	}

	private insertCheckpointRow(snapshot: NamedLocalStateSnapshot): void {
		this.db
			.prepare(
				`INSERT INTO named_checkpoints
					(id, name, version, created_at, updated_at, source_session_id, variables_json, persistent_names_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				snapshot.id,
				snapshot.name,
				snapshot.version,
				snapshot.createdAt,
				snapshot.updatedAt,
				snapshot.sourceSessionId ?? null,
				JSON.stringify(snapshot.variables),
				JSON.stringify(snapshot.persistentNames),
			);
	}

	saveSessionState(sessionId: string, state: PersistedLocalState): void {
		this.withTransaction(() => {
			this.db
				.prepare(
					`INSERT INTO session_local_state (session_id, version, variables_json, persistent_names_json, updated_at)
					VALUES (?, ?, ?, ?, ?)
					ON CONFLICT(session_id) DO UPDATE SET
						version = excluded.version,
						variables_json = excluded.variables_json,
						persistent_names_json = excluded.persistent_names_json,
						updated_at = excluded.updated_at`,
				)
				.run(
					sessionId,
					state.version,
					JSON.stringify(state.variables),
					JSON.stringify(state.persistentNames),
					Date.now(),
				);
		});
	}

	loadSessionState(sessionId: string): PersistedLocalState | undefined {
		const row = this.db
			.prepare("SELECT version, variables_json, persistent_names_json FROM session_local_state WHERE session_id = ?")
			.get(sessionId) as { version: number; variables_json: string; persistent_names_json: string } | undefined;
		if (!row) {
			return undefined;
		}
		if (row.version !== SESSION_STATE_VERSION) {
			throw new Error(`Unsupported persisted local-state version: ${row.version}.`);
		}
		return {
			version: SESSION_STATE_VERSION,
			variables: JSON.parse(row.variables_json),
			persistentNames: JSON.parse(row.persistent_names_json),
		};
	}

	saveNamedCheckpoint(
		name: string | undefined,
		state: PersistedLocalState,
		sourceSessionId?: string,
	): SaveNamedLocalStateResult {
		if (state.persistentNames.length === 0) {
			throw new Error("No persisted variables are available to save.");
		}
		return this.withTransaction(() => {
			const resolvedName = name === undefined ? this.generateUniqueName() : name;
			validateNamedLocalStateSnapshotName(resolvedName);

			const variables: Record<string, JsonSafeValue> = {};
			for (const variableName of state.persistentNames) {
				if (!isValidLocalVariableName(variableName) || !Object.hasOwn(state.variables, variableName)) {
					throw new Error(`Invalid persisted variable "${variableName}".`);
				}
				variables[variableName] = toJsonSafeValue(state.variables[variableName], variableName);
			}

			const existing = this.findCheckpointRow(resolvedName);
			const now = Date.now();
			const snapshot: NamedLocalStateSnapshot = {
				version: SNAPSHOT_VERSION,
				id: existing?.id ?? randomUUID(),
				name: resolvedName,
				createdAt: existing?.created_at ?? now,
				updatedAt: now,
				sourceSessionId,
				variables,
				persistentNames: [...state.persistentNames],
			};
			this.db
				.prepare(
					`INSERT INTO named_checkpoints
						(id, name, version, created_at, updated_at, source_session_id, variables_json, persistent_names_json)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(name) DO UPDATE SET
						version = excluded.version,
						updated_at = excluded.updated_at,
						source_session_id = excluded.source_session_id,
						variables_json = excluded.variables_json,
						persistent_names_json = excluded.persistent_names_json`,
				)
				.run(
					snapshot.id,
					snapshot.name,
					snapshot.version,
					snapshot.createdAt,
					snapshot.updatedAt,
					snapshot.sourceSessionId ?? null,
					JSON.stringify(snapshot.variables),
					JSON.stringify(snapshot.persistentNames),
				);
			return { snapshot, created: existing === undefined };
		});
	}

	getNamedCheckpoint(name: string): NamedLocalStateSnapshot | undefined {
		validateNamedLocalStateSnapshotName(name);
		const row = this.findCheckpointRow(name);
		if (!row) {
			return undefined;
		}
		if (row.version !== SNAPSHOT_VERSION) {
			throw new Error(`Unsupported saved local-state snapshot version: ${row.version}.`);
		}
		return {
			version: SNAPSHOT_VERSION,
			id: row.id,
			name: row.name,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			sourceSessionId: row.source_session_id ?? undefined,
			variables: JSON.parse(row.variables_json),
			persistentNames: JSON.parse(row.persistent_names_json),
		};
	}

	listNamedCheckpoints(): NamedLocalStateSnapshotSummary[] {
		const rows = this.db
			.prepare("SELECT name, updated_at, persistent_names_json FROM named_checkpoints ORDER BY name ASC")
			.all() as Array<{ name: string; updated_at: number; persistent_names_json: string }>;
		return rows.map((row) => ({
			name: row.name,
			updatedAt: row.updated_at,
			variableCount: (JSON.parse(row.persistent_names_json) as string[]).length,
		}));
	}

	deleteNamedCheckpoint(name: string): boolean {
		validateNamedLocalStateSnapshotName(name);
		return this.withTransaction(() => {
			const result = this.db.prepare("DELETE FROM named_checkpoints WHERE name = ?").run(name);
			return Number(result.changes) > 0;
		});
	}

	private generateUniqueName(): string {
		const timestamp = formatCheckpointTimestamp(new Date());
		for (let attempt = 0; ; attempt++) {
			const candidate = attempt === 0 ? timestamp : `${timestamp}-${String(attempt).padStart(2, "0")}`;
			if (!this.findCheckpointRow(candidate)) {
				return candidate;
			}
		}
	}

	close(): void {
		this.db.close();
	}
}
//Viraj's Code End
