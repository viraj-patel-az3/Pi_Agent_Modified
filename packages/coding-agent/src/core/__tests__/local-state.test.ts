//Viraj's Code Start
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, getMessageText, type Harness } from "../../../test/suite/harness.ts";
import { SessionManager } from "../session-manager.ts";

function getLastMessageText(harness: Harness): string {
	return getMessageText(harness.session.messages[harness.session.messages.length - 1]);
}

function getLastLocalResult(harness: Harness): string | undefined {
	const message = harness.session.messages[harness.session.messages.length - 1] as {
		details?: { entries?: Array<{ result: string }> };
	};
	return message.details?.entries?.[0]?.result;
}

describe("persisted local state", () => {
	const harnesses: Harness[] = [];
	const directories: string[] = [];

	afterEach(() => {
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

	async function createPersistedHarness(sessionFile?: string): Promise<Harness> {
		const directory = sessionFile ? undefined : mkdtempSync(join(tmpdir(), "pi-local-state-"));
		if (directory) {
			directories.push(directory);
		}
		const sessionManager = sessionFile
			? SessionManager.open(sessionFile)
			: SessionManager.create(directory ?? process.cwd(), directory);
		const harness = await createHarness({ sessionManager });
		harnesses.push(harness);
		return harness;
	}

	it("persists one number and isolates it from another session", async () => {
		const first = await createPersistedHarness();
		const promptSpy = vi.spyOn(first.session.agent, "prompt");
		await first.session.prompt("x = 5");
		await first.session.prompt("/persist x");
		expect(promptSpy).not.toHaveBeenCalled();
		const sessionFile = first.sessionManager.getSessionFile();
		expect(sessionFile).toBeDefined();

		const resumed = await createPersistedHarness(sessionFile);
		await resumed.session.prompt("x + 3");
		expect(getLastLocalResult(resumed)).toBe("8");

		const unrelated = await createPersistedHarness();
		await unrelated.session.prompt("= x");
		expect(getLastLocalResult(unrelated)).toContain("Error:");
		expect(getLastLocalResult(unrelated)).toContain("x is not defined");
	});

	it("persists several JSON-safe values and lists them", async () => {
		const first = await createPersistedHarness();
		await first.session.prompt("x = 5");
		await first.session.prompt('name = "Viraj"');
		await first.session.prompt("values = [1, 2, 3]");
		await first.session.prompt('profile = { name: "A", score: 10 }');
		await first.session.prompt("/persist x name values profile");
		expect(getLastMessageText(first)).toContain("- profile");

		const sessionFile = first.sessionManager.getSessionFile();
		const resumed = await createPersistedHarness(sessionFile);
		await resumed.session.prompt("/persist list");
		const listing = getLastMessageText(resumed);
		expect(listing).toContain("- x = 5");
		expect(listing).toContain('- name = "Viraj"');
		await resumed.session.prompt("name");
		expect(getLastLocalResult(resumed)).toBe("Viraj");
		await resumed.session.prompt("= values");
		expect(getLastLocalResult(resumed)).toContain("| 2 | 3 |");
		await resumed.session.prompt("= profile");
		expect(getLastLocalResult(resumed)).toContain("| name | string | A |");
	});

	it("updates persisted assignments and rolls back failed assignments", async () => {
		const first = await createPersistedHarness();
		await first.session.prompt("x = 5");
		await first.session.prompt("/persist x");
		await first.session.prompt("x = 10");
		await first.session.prompt("x = missingValue + 1");
		expect(getLastLocalResult(first)).toContain("Error:");
		await first.session.prompt("= x");
		expect(getLastLocalResult(first)).toBe("10");

		const resumed = await createPersistedHarness(first.sessionManager.getSessionFile());
		await resumed.session.prompt("= x");
		expect(getLastLocalResult(resumed)).toBe("10");
	});

	it("unpersists and clears durable state without clearing active values", async () => {
		const first = await createPersistedHarness();
		await first.session.prompt("x = 5");
		await first.session.prompt("name = 'A'");
		await first.session.prompt("/persist x name");
		await first.session.prompt("/unpersist x");
		await first.session.prompt("= x");
		expect(getLastLocalResult(first)).toBe("5");
		await first.session.prompt("/persist clear");
		await first.session.prompt("= name");
		expect(getLastLocalResult(first)).toBe("A");

		const resumed = await createPersistedHarness(first.sessionManager.getSessionFile());
		await resumed.session.prompt("= x");
		expect(getLastLocalResult(resumed)).toContain("x is not defined");
		await resumed.session.prompt("= name");
		expect(getLastLocalResult(resumed)).toContain("name is not defined");
	});

	it("rejects invalid names, missing values, and unsupported values atomically", async () => {
		const harness = await createPersistedHarness();
		await harness.session.prompt("x = 5");
		await harness.session.prompt("handler = () => 1");
		await harness.session.prompt("/persist x handler");
		expect(getLastMessageText(harness)).toContain('Cannot persist "handler": functions are not supported.');
		await harness.session.prompt("/persist list");
		expect(getLastMessageText(harness)).toContain("- (none)");
		await harness.session.prompt("/persist missingVariable");
		expect(getLastMessageText(harness)).toContain('Unknown local variable "missingVariable".');
		await harness.session.prompt("/persist profile.name");
		expect(getLastMessageText(harness)).toContain('Invalid variable name "profile.name".');
	});

	it("uses focused Z3 variables and JavaScript fallback bindings after resume", async () => {
		const first = await createPersistedHarness();
		await first.session.prompt("x = 5");
		await first.session.prompt("/persist x");
		const resumed = await createPersistedHarness(first.sessionManager.getSessionFile());

		await resumed.session.prompt("= x..7");
		expect(getLastLocalResult(resumed)).toContain("| 2 | 7 |");
		await resumed.session.prompt("= [x, x + 1]");
		expect(getLastLocalResult(resumed)).toContain("| 1 | 6 |");
	});

	it("supports assignments from JavaScript and Z3 prompt files", async () => {
		const harness = await createPersistedHarness();
		const jsFile = join(harness.tempDir, "state.js");
		const z3File = join(harness.tempDir, "state.z3");
		writeFileSync(jsFile, 'prompt = { prompt: ["jsValue = 11", "jsValue + 1"] }');
		writeFileSync(z3File, 'prompt = { prompt: ["z3Value = 20", "z3Value + 2"] }');

		await harness.session.prompt(`run ${jsFile}`);
		await harness.session.prompt(`run ${z3File}`);
		await harness.session.prompt("/persist jsValue z3Value");
		const resumed = await createPersistedHarness(harness.sessionManager.getSessionFile());
		await resumed.session.prompt("= jsValue + z3Value");
		expect(getLastLocalResult(resumed)).toBe("31");
	});
});
//Viraj's Code End
