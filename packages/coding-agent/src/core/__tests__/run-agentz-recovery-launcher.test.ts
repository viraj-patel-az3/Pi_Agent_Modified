//Viraj's Code Start
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Repo root: packages/coding-agent/src/core/__tests__/ -> up 5 levels
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const LAUNCHER_PATH = join(REPO_ROOT, "scripts", "run-agentz-recovery.sh");

/**
 * Builds a throwaway fake repository (with spaces in its path) containing a stub
 * `tsx` binary that just echoes its argv, so we can exercise the real launcher
 * script's path resolution logic without starting an actual AgentZ chat session.
 */
function makeFakeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "agentz launcher test "));
	mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
	mkdirSync(join(root, "packages", "coding-agent", "src"), { recursive: true });
	mkdirSync(join(root, "scripts"), { recursive: true });
	writeFileSync(join(root, "tsconfig.json"), "{}");
	writeFileSync(join(root, "packages", "coding-agent", "src", "cli.ts"), "");

	const stubTsx = join(root, "node_modules", ".bin", "tsx");
	writeFileSync(stubTsx, '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n');
	spawnSync("chmod", ["+x", stubTsx]);

	const launcherContent = spawnSync("cat", [LAUNCHER_PATH], { encoding: "utf-8" }).stdout;
	const fakeLauncher = join(root, "scripts", "run-agentz-recovery.sh");
	writeFileSync(fakeLauncher, launcherContent);
	spawnSync("chmod", ["+x", fakeLauncher]);
	return root;
}

describe("run-agentz-recovery.sh", () => {
	let fakeRepo: string;

	beforeEach(() => {
		fakeRepo = makeFakeRepo();
	});

	afterEach(() => {
		rmSync(fakeRepo, { recursive: true, force: true });
	});

	it("resolves the session directory relative to the repository root, not $PWD", () => {
		const result = spawnSync(join(fakeRepo, "scripts", "run-agentz-recovery.sh"), [], {
			cwd: tmpdir(),
			encoding: "utf-8",
		});
		const expectedSessionDir = join(fakeRepo, "results", "agent-recovery", "agentz-sessions");
		expect(result.stdout).toContain(`AgentZ session directory: ${expectedSessionDir}`);
		expect(result.stdout).toContain("--session-dir");
		expect(result.stdout).toContain(expectedSessionDir);
	});

	it("handles a repository path containing spaces", () => {
		expect(fakeRepo).toContain(" ");
		const result = spawnSync(join(fakeRepo, "scripts", "run-agentz-recovery.sh"), [], {
			encoding: "utf-8",
		});
		expect(result.status).toBe(0);
		const expectedSessionDir = join(fakeRepo, "results", "agent-recovery", "agentz-sessions");
		expect(result.stdout).toContain(expectedSessionDir);
	});

	it("forwards additional arguments and exits with the underlying process code", () => {
		const result = spawnSync(join(fakeRepo, "scripts", "run-agentz-recovery.sh"), ["--resume", "abc"], {
			encoding: "utf-8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("--resume");
		expect(result.stdout).toContain("abc");
	});
});
//Viraj's Code End
