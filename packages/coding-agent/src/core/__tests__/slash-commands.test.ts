// Viraj's code start
import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../slash-commands.ts";

describe("built-in slash commands", () => {
	it("includes zoutput with its interactive description without changing z-mode commands", () => {
		const zoutput = BUILTIN_SLASH_COMMANDS.find((command) => command.name === "zoutput");
		expect(zoutput).toEqual({ name: "zoutput", description: "View or change Z3EVAL output format" });
		expect(BUILTIN_SLASH_COMMANDS.some((command) => command.name === "z-mode")).toBe(false);
	});
});
// Viraj's code end
