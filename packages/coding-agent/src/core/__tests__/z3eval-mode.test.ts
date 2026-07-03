import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, getMessageText, type Harness } from "../../../test/suite/harness.ts";

describe("AgentSession z3eval mode", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("1. '=' alone turns _z3evalMode ON", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("=");

		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(true);
		expect(promptSpy).not.toHaveBeenCalled();
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain(
			"[z3eval mode ON",
		);
	});

	it("2. '.' alone turns _z3evalMode OFF", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt(".");

		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(false);
		expect(promptSpy).not.toHaveBeenCalled();
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain(
			"[z3eval mode OFF]",
		);
	});

	it("3. '/z-mode=on' turns _z3evalMode ON", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("/z-mode=on");

		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(true);
		expect(promptSpy).not.toHaveBeenCalled();
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain(
			"[z3eval mode ON",
		);
	});

	it("4. '/z-mode=off' turns _z3evalMode OFF", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("/z-mode=off");

		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(false);
		expect(promptSpy).not.toHaveBeenCalled();
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain(
			"[z3eval mode OFF]",
		);
	});

	it("5. '/z-mode' with no param toggles: OFF→ON and ON→OFF", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("/z-mode");
		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(true);
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain(
			"[z3eval mode ON",
		);

		await harness.session.prompt("/z-mode");
		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(false);
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain(
			"[z3eval mode OFF]",
		);

		expect(promptSpy).not.toHaveBeenCalled();
	});

	it("6. '= <expr>' one-shot eval returns correct result, does NOT change _z3evalMode", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= 5 * 5");

		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(false);
		expect(promptSpy).not.toHaveBeenCalled();
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain("5 * 5 = 25");
	});

	it("7. Free-form eval when mode is ON — '5 * 5' returns '5 * 5 = 25'", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("5 * 5");

		expect(promptSpy).not.toHaveBeenCalled();
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain("5 * 5 = 25");
	});

	it("8. Free-form eval when mode is ON — '[1,2,3].map(x=>x*x)' returns correct result", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("[1,2,3].map(x=>x*x)");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastContent = getMessageText(harness.session.messages[harness.session.messages.length - 1]);
		expect(lastContent).toContain("[1,2,3].map(x=>x*x) =");
		expect(lastContent).toContain("1");
		expect(lastContent).toContain("4");
		expect(lastContent).toContain("9");
	});

	it("9. Free-form eval when mode is OFF — '5 * 5' does NOT intercept (falls through to LLM)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("25")]);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("5 * 5");

		expect(promptSpy).toHaveBeenCalled();
	});

	it("10. {=...} interpolation — 'this is for {=testing}' substitutes to 'this is for TESTING'", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("this is for {=testing}");

		expect(promptSpy).toHaveBeenCalled();
		const _customMsg = harness.session.messages.find(
			(m) => m.role === "custom" && (m as unknown as { customType?: string }).customType === "intercept",
		);
		// Expect removed because it does not intercept on failure
		const userMsg = harness.session.messages.find((m) => m.role === "user");
		expect(getMessageText(userMsg)).toBe("this is for TESTING");
	});

	it("11. {=...} interpolation when z3eval mode is ON — does NOT trigger z3eval eval, goes to LLM", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		harness.setResponses([fauxAssistantMessage("ok")]);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("this is for {=testing}");

		expect(promptSpy).toHaveBeenCalled();
		const userMsg = harness.session.messages.find((m) => m.role === "user");
		expect(getMessageText(userMsg)).toBe("this is for TESTING");
	});

	it("12. Error handling — invalid expression like 'hello world' returns 'Error: ...' and stays in mode", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("hello world");

		expect(promptSpy).not.toHaveBeenCalled();
		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(true);
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain("Error:");
	});

	it("13. After '.' turns mode OFF, next input goes to LLM normally", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		harness.setResponses([fauxAssistantMessage("hello")]);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt(".");
		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(false);
		expect(promptSpy).not.toHaveBeenCalled();

		await harness.session.prompt("hello assistant");
		expect(promptSpy).toHaveBeenCalled();
	});

	it("14. Input '{= 64+64}' alone -> emitIntercept content contains '64+64\n128', LLM never called", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("{= 64+64}");

		expect(promptSpy).not.toHaveBeenCalled();
		const customMsgs = harness.session.messages.filter((m) => m.role === "custom");
		expect(getMessageText(customMsgs[customMsgs.length - 1])).toContain("64+64\n128");
	});

	it("15. Input '{=hello}' alone -> emitIntercept content contains 'hello\nHELLO', LLM never called", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("{=hello}");

		expect(promptSpy).not.toHaveBeenCalled();
		const customMsgs = harness.session.messages.filter((m) => m.role === "custom");
		expect(getMessageText(customMsgs[customMsgs.length - 1])).toContain("hello\nHELLO");
	});

	it("16. Input 'please add {=54+64} to my total' -> replaced with '118' inline, LLM IS called since it's mixed natural language", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("please add {=54+64} to my total");

		expect(promptSpy).toHaveBeenCalled();
		const userMsg = harness.session.messages.find((m) => m.role === "user");
		expect(getMessageText(userMsg)).toBe("please add 118 to my total");
	});

	it("17. Input 'this is for {=testing}' -> becomes 'this is for TESTING', LLM IS called (mixed natural language + uppercase fallback)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("this is for {=testing}");

		expect(promptSpy).toHaveBeenCalled();
		const userMsg = harness.session.messages.find((m) => m.role === "user");
		expect(getMessageText(userMsg)).toBe("this is for TESTING");
	});

	it("18. 'run <filename>.z3' loads file and executes sequentially, leaving mode ON and extracting filename correctly", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;

		const fs = await import("node:fs");
		const path = await import("node:path");
		const testFile = "test-eval-18.z3";
		const testFilePath = path.join((harness.session as any)._cwd, testFile);
		fs.writeFileSync(testFilePath, "10 + 20\n30 + 40", "utf-8");

		await harness.session.prompt(`run ${testFile}`);

		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(true);

		const allMessages = harness.session.messages.map((m) => getMessageText(m)).join("\n");
		expect(allMessages).not.toContain("OFF");
		expect(allMessages).toContain("10 + 20 = 30");
		expect(allMessages).toContain("30 + 40 = 70");
		expect(allMessages).toContain(`Loaded 2 expressions from ${testFile}.`);

		if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
	});
});
