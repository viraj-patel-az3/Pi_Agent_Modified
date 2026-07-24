//Viraj's Code Start
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, getMessageText, type Harness } from "../../../test/suite/harness.ts";
import { formatCheckpointTimestamp, validateNamedLocalStateSnapshotName } from "../named-local-state-store.ts";
import { SessionManager } from "../session-manager.ts";
import { SQLiteLocalStateStore } from "../sqlite-local-state-store.ts";

function getLastMessageText(harness: Harness): string {
	return getMessageText(harness.session.messages[harness.session.messages.length - 1]);
}

function getLastLocalResult(harness: Harness): string | undefined {
	const message = harness.session.messages[harness.session.messages.length - 1] as {
		details?: { entries?: Array<{ result: string }> };
	};
	return message.details?.entries?.[0]?.result;
}

function getGeneratedName(message: string): string {
	const match = message.match(/- (\d{14}(?:-\d{2,})?)/);
	if (!match) {
		throw new Error(`Generated snapshot name was not found in: ${message}`);
	}
	return match[1];
}

describe("named local-state sessions", () => {
	const harnesses: Harness[] = [];
	const directories: string[] = [];

	afterEach(() => {
		vi.useRealTimers();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		while (directories.length > 0) {
			const directory = directories.pop();
			if (directory && existsSync(directory)) {
				rmSync(directory, { recursive: true });
			}
		}
	});

	function createStorageDirectory(): string {
		const directory = mkdtempSync(join(tmpdir(), "pi-named-local-state-"));
		directories.push(directory);
		return directory;
	}

	async function createStoredHarness(directory: string, withConfiguredAuth = true): Promise<Harness> {
		const harness = await createHarness({
			sessionManager: SessionManager.create(directory, directory),
			withConfiguredAuth,
		});
		harnesses.push(harness);
		return harness;
	}

	it("saves and restores a named snapshot in a new session without calling the LLM", async () => {
		const directory = createStorageDirectory();
		const first = await createStoredHarness(directory, false);
		const firstPrompt = vi.spyOn(first.session.agent, "prompt");
		await first.session.prompt("x = 7");
		await first.session.prompt("/persist x");
		await first.session.prompt("/persist session calculation-demo");
		expect(getLastMessageText(first)).toContain("Created saved local-state session:\n- calculation-demo");
		expect(firstPrompt).not.toHaveBeenCalled();

		const second = await createStoredHarness(directory, false);
		const secondPrompt = vi.spyOn(second.session.agent, "prompt");
		await second.session.prompt("= x");
		expect(getLastLocalResult(second)).toContain("x is not defined");
		await second.session.prompt("/restoresession calculation-demo");
		await second.session.prompt("x + 3");
		expect(getLastLocalResult(second)).toBe("10");
		expect(secondPrompt).not.toHaveBeenCalled();

		await second.session.prompt("x = 10");
		const resumed = await createHarness({
			sessionManager: SessionManager.open(second.sessionManager.getSessionFile()!),
			withConfiguredAuth: false,
		});
		harnesses.push(resumed);
		await resumed.session.prompt("= x");
		expect(getLastLocalResult(resumed)).toBe("10");
	});

	it("formats checkpoint timestamps from UTC components", () => {
		expect(formatCheckpointTimestamp(new Date("2026-01-02T00:04:05.999Z"))).toBe("20260102000405");
		expect(formatCheckpointTimestamp(new Date("2026-12-09T23:08:07.000Z"))).toBe("20261209230807");
		expect(formatCheckpointTimestamp(new Date("2026-12-31T23:59:59.999Z"))).toBe("20261231235959");
		expect(formatCheckpointTimestamp(new Date("2027-01-01T00:00:00.000Z"))).toBe("20270101000000");
	});

	it("generates collision-safe names that list, restore, and delete", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-22T17:05:30.999Z"));
		const directory = createStorageDirectory();
		const first = await createStoredHarness(directory);
		await first.session.prompt("x = 7");
		await first.session.prompt("/persist x");
		await first.session.prompt("/persist session");
		const firstName = getGeneratedName(getLastMessageText(first));
		await first.session.prompt("/persist session");
		const secondName = getGeneratedName(getLastMessageText(first));
		await first.session.prompt("/persist session");
		const thirdName = getGeneratedName(getLastMessageText(first));
		expect(firstName).toBe("20260722170530");
		expect(secondName).toBe("20260722170530-01");
		expect(thirdName).toBe("20260722170530-02");

		await first.session.prompt("/restoresession list");
		const listing = getLastMessageText(first);
		expect(listing).toContain(`- ${firstName} (1 variable`);
		expect(listing).toContain(`- ${secondName} (1 variable`);
		expect(listing).toContain(`- ${thirdName} (1 variable`);

		const second = await createStoredHarness(directory);
		await second.session.prompt(`/restoresession ${firstName}`);
		await second.session.prompt("= x");
		expect(getLastLocalResult(second)).toBe("7");
		await second.session.prompt(`/deletesession ${firstName}`);
		expect(getLastMessageText(second)).toContain(`Deleted saved local-state session:\n- ${firstName}`);
		await second.session.prompt("/restoresession list");
		expect(getLastMessageText(second)).not.toContain(`- ${firstName} (`);
	});

	it("does not overwrite an explicit timestamp name during automatic generation", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-22T17:05:30.000Z"));
		const directory = createStorageDirectory();
		const harness = await createStoredHarness(directory);
		await harness.session.prompt("x = 7");
		await harness.session.prompt("/persist x");
		await harness.session.prompt("/persist session 20260722170530");
		await harness.session.prompt("x = 8");
		await harness.session.prompt("/persist session");
		expect(getGeneratedName(getLastMessageText(harness))).toBe("20260722170530-01");

		const restored = await createStoredHarness(directory);
		await restored.session.prompt("/restoresession 20260722170530");
		await restored.session.prompt("= x");
		expect(getLastLocalResult(restored)).toBe("7");
	});

	it("updates snapshots explicitly but does not auto-update them", async () => {
		const directory = createStorageDirectory();
		const first = await createStoredHarness(directory);
		await first.session.prompt("x = 5");
		await first.session.prompt("/persist x");
		await first.session.prompt("/persist session demo");
		await first.session.prompt("x = 10");

		const beforeUpdate = await createStoredHarness(directory);
		await beforeUpdate.session.prompt("/restoresession demo");
		await beforeUpdate.session.prompt("= x");
		expect(getLastLocalResult(beforeUpdate)).toBe("5");

		await first.session.prompt("/persist session demo");
		expect(getLastMessageText(first)).toContain("Updated saved local-state session:");
		const afterUpdate = await createStoredHarness(directory);
		await afterUpdate.session.prompt("/restoresession demo");
		await afterUpdate.session.prompt("= x");
		expect(getLastLocalResult(afterUpdate)).toBe("10");
	});

	it("merges restored variables while preserving unrelated active state", async () => {
		const directory = createStorageDirectory();
		const source = await createStoredHarness(directory);
		await source.session.prompt("x = 7");
		await source.session.prompt('name = "demo"');
		await source.session.prompt("/persist x name");
		await source.session.prompt("/persist session demo");

		const target = await createStoredHarness(directory);
		await target.session.prompt("temporary = 100");
		await target.session.prompt("x = 2");
		await target.session.prompt("/restoresession demo");
		await target.session.prompt("= [temporary, x, name]");
		const result = getLastLocalResult(target);
		expect(result).toContain("| 1 | 7 |");
		expect(result).toContain("| 2 | demo |");
		expect(result).toContain("| 0 | 100 |");
	});

	it("handles missing, invalid, empty, and deleted snapshots locally", async () => {
		const directory = createStorageDirectory();
		const harness = await createStoredHarness(directory, false);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("/persist session empty-demo");
		expect(getLastMessageText(harness)).toContain("No persisted variables are available to save.");
		await harness.session.prompt("/restoresession missing");
		expect(getLastMessageText(harness)).toContain('No saved local-state session named "missing" was found.');
		await harness.session.prompt("/restoresession ../escape");
		expect(getLastMessageText(harness)).toContain("Error:");

		await harness.session.prompt("x = 7");
		await harness.session.prompt("/persist x");
		await harness.session.prompt("/persist session demo");
		await harness.session.prompt("/deletesession demo");
		expect(getLastMessageText(harness)).toContain("Deleted saved local-state session:\n- demo");
		await harness.session.prompt("= x");
		expect(getLastLocalResult(harness)).toBe("7");
		await harness.session.prompt("/restoresession demo");
		expect(getLastMessageText(harness)).toContain('No saved local-state session named "demo" was found.');
		await harness.session.prompt("/deletesession demo");
		expect(getLastMessageText(harness)).toContain('No saved local-state session named "demo" was found.');
		expect(promptSpy).not.toHaveBeenCalled();
	});

	it("keeps active and durable local state unchanged when snapshot validation fails", async () => {
		const directory = createStorageDirectory();
		const harness = await createStoredHarness(directory);
		await harness.session.prompt("x = 2");
		await harness.session.prompt("/persist x");
		await harness.session.prompt("/persist session broken");
		const sessionId = harness.sessionManager.getSessionId();
		const before = new SQLiteLocalStateStore(directory).loadSessionState(sessionId);

		const db = new DatabaseSync(join(directory, "agentz-local-state.sqlite"));
		db.prepare("UPDATE named_checkpoints SET version = 99 WHERE name = ?").run("broken");
		db.close();

		await harness.session.prompt("/restoresession broken");
		expect(getLastMessageText(harness)).toContain("Unsupported saved local-state snapshot version: 99.");
		await harness.session.prompt("= x");
		expect(getLastLocalResult(harness)).toBe("2");
		const after = new SQLiteLocalStateStore(directory).loadSessionState(sessionId);
		expect(after).toEqual(before);
	});

	it("uses restored bindings in JavaScript, focused Z3, and prompt files", async () => {
		const directory = createStorageDirectory();
		const source = await createStoredHarness(directory);
		await source.session.prompt("x = 7");
		await source.session.prompt("/persist x");
		await source.session.prompt("/persist session demo");

		const target = await createStoredHarness(directory);
		await target.session.prompt("/restoresession demo");
		await target.session.prompt("= [x, x + 1, x + 2]");
		expect(getLastLocalResult(target)).toContain("| 2 | 9 |");
		await target.session.prompt("= x..9");
		expect(getLastLocalResult(target)).toContain("| 2 | 9 |");

		const jsFile = join(target.tempDir, "use-x.js");
		const z3File = join(target.tempDir, "use-x.z3");
		writeFileSync(jsFile, 'prompt = { prompt: "x + 3" }');
		writeFileSync(z3File, 'prompt = { prompt: "x + 3" }');
		await target.session.prompt(`run ${jsFile}`);
		expect(target.session.messages.some((message) => getMessageText(message).includes("x + 3\n10"))).toBe(true);
		await target.session.prompt(`run ${z3File}`);
		expect(target.session.messages.some((message) => getMessageText(message).includes("x + 3\n10"))).toBe(true);
	});

	it("validates names independently of filesystem paths", () => {
		for (const name of ["calculation-demo", "project_alpha", "layout1", "tax-2026", "my.session"]) {
			expect(() => validateNamedLocalStateSnapshotName(name)).not.toThrow();
		}
		for (const name of [
			"",
			"../escape",
			"a/b",
			"a\\b",
			"/absolute",
			"trailing ",
			"a;rm",
			"a\u0000b",
			"a".repeat(65),
		]) {
			expect(() => validateNamedLocalStateSnapshotName(name)).toThrow();
		}
	});
});
//Viraj's Code End
