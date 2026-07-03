import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.ts";
import { InteractiveMode } from "../src/modes/index.ts";

vi.mock("../src/modes/index.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/modes/index.ts")>();
	return {
		...actual,
		InteractiveMode: vi.fn().mockImplementation(() => {
			return {
				init: vi.fn(),
				run: vi.fn().mockResolvedValue(undefined),
				stop: vi.fn(),
			};
		}),
	};
});

describe("z3eval file mode", () => {
	let originalExit: typeof process.exit;
	let originalLog: typeof console.log;
	let originalError: typeof console.error;
	let exitMock: any;
	let logMock: any;
	let errorMock: any;
	let testFilePath: string;
	let originalIsTTY: boolean | undefined;

	beforeEach(() => {
		originalExit = process.exit;
		originalLog = console.log;
		originalError = console.error;
		originalIsTTY = process.stdin.isTTY;
		process.stdin.isTTY = true;

		exitMock = vi.fn((code) => {
			throw new Error(`process.exit called with ${code}`);
		});
		logMock = vi.fn();
		errorMock = vi.fn();

		process.exit = exitMock as any;
		console.log = logMock;
		console.error = errorMock;

		testFilePath = path.join(process.cwd(), "test-file.z3");
	});

	afterEach(() => {
		process.exit = originalExit;
		console.log = originalLog;
		console.error = originalError;
		process.stdin.isTTY = originalIsTTY as any;
		if (fs.existsSync(testFilePath)) {
			fs.unlinkSync(testFilePath);
		}
		vi.clearAllMocks();
	});

	it("1. runs a valid .z3 file and exits", async () => {
		fs.writeFileSync(testFilePath, "10 + 20\n# comment\n30 + 40", "utf-8");

		await expect(main(["--no-session", "--offline", testFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenCalledWith("10 + 20 = 30");
		expect(logMock).toHaveBeenCalledWith("30 + 40 = 70");
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("Processed 2 expressions from test-file.z3."));
	});

	it("2. runs with --repl flag and transitions into REPL", async () => {
		fs.writeFileSync(testFilePath, "10 + 20\n", "utf-8");

		// If --repl is provided, it shouldn't call process.exit(0) early
		try {
			await main(["--no-session", "--offline", "--repl", testFilePath]);
		} catch (err) {
			console.warn("errorMock calls test 2:", errorMock.mock.calls);
			throw err;
		}

		expect(logMock).toHaveBeenCalledWith("10 + 20 = 30");
		expect(logMock).toHaveBeenCalledWith('[z3eval mode ON — type expressions directly, "." alone to exit]');

		// Interactive mode should be initialized
		expect(InteractiveMode).toHaveBeenCalled();
	});

	it("3. errors on non-existent file path", async () => {
		const badPath = "non-existent-test-file.z3";
		console.warn(errorMock.mock.calls);
		await expect(main(["--no-session", "--offline", badPath])).rejects.toThrow("process.exit called with 1");
		expect(errorMock).toHaveBeenCalledWith(
			expect.stringContaining(`Error: could not read file ${path.resolve(badPath)}`),
		);
	});
});
