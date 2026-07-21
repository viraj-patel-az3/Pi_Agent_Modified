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
		//Viraj's Code Start
		const testJsFilePath = path.join(process.cwd(), "test-file.js");
		if (fs.existsSync(testJsFilePath)) {
			fs.unlinkSync(testJsFilePath);
		}
		//Viraj's Code end
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
	//Viraj's Code Start
	it("4. groups multiline object expressions in .z3 files before local evaluation", async () => {
		fs.writeFileSync(
			testFilePath,
			`{
  label: "scores",
  note: "brace { text }",
  values: [
    { name: "A", score: 1 },
    { name: "B", score: 2 }
  ]
}
64 + 64`,
			"utf-8",
		);

		await expect(main(["--no-session", "--offline", testFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("| name | score |"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("64 + 64 = 128"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("Processed 2 expressions from test-file.z3."));
	});

	it("5. executes prompt assignment blocks in .z3 files", async () => {
		fs.writeFileSync(
			testFilePath,
			`prompt = {
  prompt: "64 + 64"
}`,
			"utf-8",
		);

		await expect(main(["--no-session", "--offline", testFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenCalledWith("64 + 64 = 128");
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("Processed 1 expressions from test-file.z3."));
	});

	it("6. executes focused Z3 prompt values before JavaScript fallback in .z3 files", async () => {
		fs.writeFileSync(
			testFilePath,
			`prompt = {
  prompt: "1..5"
}`,
			"utf-8",
		);

		await expect(main(["--no-session", "--offline", testFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("1..5 = | Index | Value |"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("| 4 | 5 |"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("Processed 1 expressions from test-file.z3."));
	});

	it("7. executes prompt assignment blocks in .js files", async () => {
		const jsFilePath = path.join(process.cwd(), "test-file.js");
		fs.writeFileSync(
			jsFilePath,
			`prompt = {
  prompt: "[1, 2, 3].map(value => value * value)"
}`,
			"utf-8",
		);

		await expect(main(["--no-session", "--offline", jsFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("[1, 2, 3].map(value => value * value) = "));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("| 0 | 1 |"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("| 1 | 4 |"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("| 2 | 9 |"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("Processed 1 expressions from test-file.js."));

		if (fs.existsSync(jsFilePath)) fs.unlinkSync(jsFilePath);
	});

	it("8. executes prompt arrays and metadata fields sequentially", async () => {
		fs.writeFileSync(
			testFilePath,
			`prompt = {
  name: "metadata",
  enabled: true,
  prompt: [
    "10 + 20",
    "30 + 40"
  ]
}`,
			"utf-8",
		);

		await expect(main(["--no-session", "--offline", testFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenCalledWith("10 + 20 = 30");
		expect(logMock).toHaveBeenCalledWith("30 + 40 = 70");
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("Processed 2 expressions from test-file.z3."));
	});

	it("9. handles multiline prompt strings and table formatting", async () => {
		fs.writeFileSync(
			testFilePath,
			`prompt = {
  prompt: \`
    [
      { name: "A", score: 10 },
      { name: "B", score: 20 }
    ]
  \`
}`,
			"utf-8",
		);

		await expect(main(["--no-session", "--offline", testFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("| name | score |"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("| A | 10 |"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("| B | 20 |"));
	});

	it("10. keeps braces inside prompt strings inside the same block", async () => {
		const jsFilePath = path.join(process.cwd(), "test-file.js");
		fs.writeFileSync(
			jsFilePath,
			`prompt = {
  prompt: "\`Text with { braces }\`"
}`,
			"utf-8",
		);

		await expect(main(["--no-session", "--offline", jsFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenCalledWith("`Text with { braces }` = Text with { braces }");

		if (fs.existsSync(jsFilePath)) fs.unlinkSync(jsFilePath);
	});

	it("11. executes multiple prompt blocks and ordinary expressions in order", async () => {
		const jsFilePath = path.join(process.cwd(), "test-file.js");
		fs.writeFileSync(
			jsFilePath,
			`prompt = {
  prompt: "10 + 20"
}

40 + 50

prompt = {
  prompt: "[1, 2, 3]"
}`,
			"utf-8",
		);

		await expect(main(["--no-session", "--offline", jsFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenNthCalledWith(1, "10 + 20 = 30");
		expect(logMock).toHaveBeenNthCalledWith(2, "40 + 50 = 90");
		expect(logMock).toHaveBeenNthCalledWith(3, expect.stringContaining("[1, 2, 3] = | Index | Value |"));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("Processed 3 expressions from test-file.js."));

		if (fs.existsSync(jsFilePath)) fs.unlinkSync(jsFilePath);
	});

	it("12. keeps malformed multiline object blocks on the file-mode error path", async () => {
		fs.writeFileSync(
			testFilePath,
			`{
  label: "scores",
  values: [1, 2, 3]
`,
			"utf-8",
		);

		await expect(main(["--no-session", "--offline", testFilePath])).rejects.toThrow("process.exit called with 0");

		expect(logMock).toHaveBeenCalledWith(expect.stringContaining('label: "scores"'));
		expect(logMock).toHaveBeenCalledWith(expect.stringContaining("Processed 1 expressions from test-file.z3."));
	});

	it("13. errors on non-existent .js file path", async () => {
		const badPath = "non-existent-test-file.js";
		await expect(main(["--no-session", "--offline", badPath])).rejects.toThrow("process.exit called with 1");
		expect(errorMock).toHaveBeenCalledWith(
			expect.stringContaining(`Error: could not read file ${path.resolve(badPath)}`),
		);
	});
	//Viraj's Code end
});
