//Viraj's code start
import fs from "node:fs";
import path from "node:path";
//Viraj's code end
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
		//Viraj's code start
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			role: string;
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.role).toBe("custom");
		expect(lastMessage.customType).toBe("local-eval");
		expect(lastMessage.details?.entries).toEqual([{ query: "5 * 5", result: "25" }]);
		expect(getMessageText(lastMessage)).toContain("5 * 5\n25");
		//Viraj's code end
	});

	it("7. Free-form eval when mode is ON — '5 * 5' returns '5 * 5 = 25'", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("5 * 5");

		expect(promptSpy).not.toHaveBeenCalled();
		//Viraj's code start
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain("5 * 5\n25");
		//Viraj's code end
	});

	it("8. Free-form eval when mode is ON — '[1,2,3].map(x=>x*x)' returns correct result", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("[1,2,3].map(x=>x*x)");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastContent = getMessageText(harness.session.messages[harness.session.messages.length - 1]);
		//Viraj's code start
		expect(lastContent).toContain("[1,2,3].map(x=>x*x)\n");
		expect(lastContent).toContain("| Index | Value |");
		expect(lastContent).toContain("| 0 | 1 |");
		expect(lastContent).toContain("| 1 | 4 |");
		expect(lastContent).toContain("| 2 | 9 |");
		//Viraj's code end
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
		//Viraj's code start
		const lastCustom = customMsgs[customMsgs.length - 1] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastCustom.customType).toBe("local-eval");
		expect(lastCustom.details?.entries).toEqual([{ query: "64+64", result: "128" }]);
		expect(getMessageText(lastCustom)).toContain("64+64\n128");
		//Viraj's code end
	});

	it("15. Input '{=hello}' alone -> emitIntercept content contains 'hello\nHELLO', LLM never called", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("{=hello}");

		expect(promptSpy).not.toHaveBeenCalled();
		const customMsgs = harness.session.messages.filter((m) => m.role === "custom");
		//Viraj's code start
		expect(getMessageText(customMsgs[customMsgs.length - 1])).toContain("hello\nHELLO");
		//Viraj's code end
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

	//Viraj's code start
	it("18. 'run <filename>.z3' loads file and executes sequentially, leaving mode ON and extracting filename correctly", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;

		const testFile = "test-eval-18.z3";
		const testFilePath = path.join((harness.session as any)._cwd, testFile);
		fs.writeFileSync(testFilePath, "10 + 20\n30 + 40", "utf-8");

		await harness.session.prompt(`run ${testFile}`);

		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(true);

		const allMessages = harness.session.messages.map((m) => getMessageText(m)).join("\n");
		expect(allMessages).not.toContain("OFF");
		//Viraj's code start
		expect(allMessages).toContain("10 + 20\n30");
		expect(allMessages).toContain("30 + 40\n70");
		//Viraj's code end
		expect(allMessages).toContain(`Loaded 2 expressions from ${testFile}.`);

		if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
	});
	//Viraj's code end

	//Viraj's code start
	it("19. one-shot local eval renders simple object arrays as markdown tables", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= [{name:'a', score:1}, {name:'b', score:2}]");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.customType).toBe("local-eval");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| name | score |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| a | 1 |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| b | 2 |");
	});

	it("20. one-shot local eval renders matrices with a leading row column", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= [[1,2],[3,4]]");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.customType).toBe("local-eval");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| Row | Column 1 | Column 2 |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 0 | 1 | 2 |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 1 | 3 | 4 |");
	});

	it("21. one-shot local eval renders single-column matrices with row indexes", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= [[-1479.50],[-1399.66]]");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.customType).toBe("local-eval");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| Row | Column 1 |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 0 | -1479.5 |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 1 | -1399.66 |");
	});

	it("22. one-shot local eval renders ragged arrays as nested tables without matrix formatting", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= [[1,2],[3]]");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.customType).toBe("local-eval");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| Index | Type | Value |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("Item 0:");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("Item 1:");
		expect(lastMessage.details?.entries?.[0]?.result).not.toContain("| Row | Column 1 |");
	});

	it("23. continuous mode evaluates SIN ranges locally and keeps mode enabled", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("SIN(1..10)");

		expect(promptSpy).not.toHaveBeenCalled();
		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(true);
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.customType).toBe("local-eval");
		expect(lastMessage.details?.entries?.[0]?.query).toBe("SIN(1..10)");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| Index | Value |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 0 |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 9 |");
		expect(getMessageText(lastMessage)).not.toContain("[object Promise]");
	});

	it("24. one-shot PMT scalar evaluation stays local and returns the expected payment", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= PMT(10%,10,10000,0,1)");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.customType).toBe("local-eval");
		const payment = Number(lastMessage.details?.entries?.[0]?.result ?? "");
		expect(payment).toBeCloseTo(-1479.5035898410138, 12);
	});

	it("25. vectorized PMT results render with the existing single-column matrix table", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= PMT(10%,10..20,10000,0,1)");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.customType).toBe("local-eval");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| Row | Column 1 |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 0 | -1479.5035898410138 |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 10 |");
	});

	it("26. focused evaluator validation errors stay local and preserve continuous mode", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("PMT(10%,0,10000,0,1)");

		expect(promptSpy).not.toHaveBeenCalled();
		expect((harness.session as unknown as { _z3evalMode: boolean })._z3evalMode).toBe(true);
		expect(getMessageText(harness.session.messages[harness.session.messages.length - 1])).toContain(
			"Error: nper cannot be zero",
		);
	});

	it("27. inline focused syntax keeps mixed text inline for scalar values", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("rate is {= 10% } today");

		expect(promptSpy).toHaveBeenCalled();
		const userMsg = harness.session.messages.find((message) => message.role === "user");
		expect(getMessageText(userMsg)).toBe("rate is 0.1 today");
	});

	it("28. plain JavaScript arrays continue to work through the fallback path", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= [10,20,30]");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			details?: { entries?: Array<{ result: string }> };
		};
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| Index | Value |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 0 | 10 |");
		expect(lastMessage.details?.entries?.[0]?.result).toContain("| 2 | 30 |");
	});

	it("29. .z3 execution uses the shared evaluator for focused syntax", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;
		const testFile = "test-eval-29.z3";
		const testFilePath = path.join((harness.session as any)._cwd, testFile);
		fs.writeFileSync(testFilePath, "SIN(1..3)\nPMT(10%,10,10000,0,1)", "utf-8");

		await harness.session.prompt(`run ${testFile}`);

		const allMessages = harness.session.messages.map((message) => getMessageText(message)).join("\n");
		expect(allMessages).toContain("SIN(1..3)");
		expect(allMessages).toContain("| Index | Value |");
		expect(allMessages).toContain("PMT(10%,10,10000,0,1)");
		expect(allMessages).toContain("-1479.5035898410138");

		if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
	});

	it("30. deeply nested arrays and objects render nested tables without object coercion", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt(`= [
			"root",
			[
				"level-1",
				[
					"level-2",
					[
						"level-3",
						{
							name: "nested-object",
							values: [1, 2, [3, 4]]
						}
					]
				]
			],
			{
				section: "object-section",
				children: [
					{
						id: 1,
						children: [
							{
								id: 2,
								children: []
							}
						]
					}
				]
			}
		]`);

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			details?: { entries?: Array<{ result: string }> };
		};
		const result = lastMessage.details?.entries?.[0]?.result ?? "";
		expect(result).toContain("| Index | Type | Value |");
		expect(result).toContain("| 0 | string | root |");
		expect(result).toContain("Item 1:");
		expect(result).toContain("Item 2:");
		expect(result).toContain("| Key | Type | Value |");
		expect(result).toContain("nested-object");
		expect(result).not.toContain("[object Object]");
	});

	it("31. nested values exceeding the display depth show the maximum-depth fallback", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= [[[[[[['too-deep']]]]]]]");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			details?: { entries?: Array<{ result: string }> };
		};
		expect(lastMessage.details?.entries?.[0]?.result).toContain("Maximum display depth reached");
	});

	it("32. circular arrays render a circular-reference placeholder without crashing", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= (() => { const circularArray = ['root']; circularArray.push(circularArray); return circularArray; })()");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			details?: { entries?: Array<{ result: string }> };
		};
		const result = lastMessage.details?.entries?.[0]?.result ?? "";
		expect(result).toContain("[Circular Reference]");
		expect(result).toContain("| Index | Type | Value |");
	});

	it("33. mixed primitive, object, and nested-array values remain readable in local rendering", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("= [1, { label: 'object', values: [2, 3] }, ['nested', { ok: true }], false]");

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			details?: { entries?: Array<{ result: string }> };
		};
		const result = lastMessage.details?.entries?.[0]?.result ?? "";
		expect(result).toContain("| Index | Type | Value |");
		expect(result).toContain("| 0 | number | 1 |");
		expect(result).toContain("| 3 | boolean | false |");
		expect(result).toContain("Key values:");
		expect(result).toContain("Item 2:");
	});

	//Viraj's code start
	it("34. inline interpolation replaces a single placeholder synchronously without emitting [object Promise]", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("23+{=23+23}");

		expect(promptSpy).toHaveBeenCalledTimes(1);
		const userMessages = harness.session.messages.filter((message) => message.role === "user");
		expect(userMessages).toHaveLength(1);
		expect(getMessageText(userMessages[0])).toBe("23+46");
		expect(getMessageText(userMessages[0])).not.toContain("[object Promise]");
	});

	it("35. inline interpolation supports multiple repeated and adjacent placeholders", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);

		await harness.session.prompt("{=20+3}+{=40+6}");
		await harness.session.prompt("{=2+2}, {=2+2}, {=2+2}");
		await harness.session.prompt("{=2+1}{=4+2}");

		const userMessages = harness.session.messages.filter((message) => message.role === "user");
		expect(getMessageText(userMessages[0])).toBe("23+46");
		expect(getMessageText(userMessages[1])).toBe("4, 4, 4");
		const lastMessage = harness.session.messages[harness.session.messages.length - 1];
		expect(getMessageText(lastMessage)).toContain("36");
		expect(harness.session.messages.map((message) => getMessageText(message)).join("\n")).not.toContain(
			"[object Promise]",
		);
	});

	it("36. inline interpolation preserves surrounding text including start and end placeholders", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("ok"),
			fauxAssistantMessage("ok"),
			fauxAssistantMessage("ok"),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("{=20+3} apples");
		await harness.session.prompt("Total: {=40+6}");
		await harness.session.prompt("Before {=10+5} after");
		await harness.session.prompt("ordinary prompt text");

		const userMessages = harness.session.messages.filter((message) => message.role === "user");
		expect(getMessageText(userMessages[0])).toBe("23 apples");
		expect(getMessageText(userMessages[1])).toBe("Total: 46");
		expect(getMessageText(userMessages[2])).toBe("Before 15 after");
		expect(getMessageText(userMessages[3])).toBe("ordinary prompt text");
	});

	it("37. inline interpolation preserves falsy scalar results", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("ok"),
			fauxAssistantMessage("ok"),
			fauxAssistantMessage("ok"),
			fauxAssistantMessage("ok"),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("Value: {=0}");
		await harness.session.prompt("Flag: {=false}");
		await harness.session.prompt("Blank:{=\"\"}");
		await harness.session.prompt("Null:{=null}");
		await harness.session.prompt("Undefined:{=undefined}");

		const userMessages = harness.session.messages.filter((message) => message.role === "user");
		expect(getMessageText(userMessages[0])).toBe("Value: 0");
		expect(getMessageText(userMessages[1])).toBe("Flag: false");
		expect(getMessageText(userMessages[2])).toBe("Blank:");
		expect(getMessageText(userMessages[3])).toBe("Null:");
		expect(getMessageText(userMessages[4])).toBe("Undefined:");
	});

	it("38. invalid inline expressions use the local-eval error path and do not call the LLM", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt("23+{=23+}");

		expect(promptSpy).not.toHaveBeenCalled();
		const userMessages = harness.session.messages.filter((message) => message.role === "user");
		expect(userMessages).toHaveLength(0);
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			role: string;
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.role).toBe("custom");
		expect(lastMessage.customType).toBe("local-eval");
		expect(lastMessage.details?.entries).toEqual([
			{
				query: "23+",
				result: expect.stringContaining("Error:"),
			},
		]);
		expect(getMessageText(lastMessage)).not.toContain("[object Promise]");
	});

	it("39. direct local evaluation is synchronous and not a Promise", () => {
		const harnessPromise = createHarness();
		return harnessPromise.then((harness) => {
			harnesses.push(harness);
			const result = harness.session._resolveLocally("23+23");
			expect(result).not.toBeInstanceOf(Promise);
			expect(result).toBe(46);
		});
	});
	//Viraj's Code Start
	it("40. JavaScript baseline uses generic object-expression evaluation with shared formatting", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");

		await harness.session.prompt(`= {
			label: "scores",
			note: "brace { text }",
			values: [{ name: "A", score: 1 }, { name: "B", score: 2 }]
		}`);

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 1] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.customType).toBe("local-eval");
		const result = lastMessage.details?.entries?.[0]?.result ?? "";
		expect(result).toContain("label: scores");
		expect(result).toContain("note: brace { text }");
		expect(result).toContain("values:");
		expect(result).toContain("| name | score |");
		expect(result).toContain("| A | 1 |");
		expect(result).toContain("| B | 2 |");
	});

	it("41. run <file>.js executes prompt assignment blocks with the JavaScript evaluator", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");
		const testFile = "test-eval-41.js";
		const testFilePath = path.join((harness.session as unknown as { _cwd: string })._cwd, testFile);
		fs.writeFileSync(
			testFilePath,
			`prompt = {
  prompt: "64 + 64"
}`,
			"utf-8",
		);

		await harness.session.prompt(`run ${testFile}`);

		expect(promptSpy).not.toHaveBeenCalled();
		const localEvalMessages = harness.session.messages.filter(
			(message) => message.role === "custom" && (message as { customType?: string }).customType === "local-eval",
		) as Array<{ details?: { entries?: Array<{ query: string; result: string }> } }>;
		expect(localEvalMessages[0].details?.entries).toEqual([{ query: "64 + 64", result: "128" }]);
		const allMessages = harness.session.messages.map((message) => getMessageText(message)).join("\n");
		expect(allMessages).toContain(`Loaded 1 expressions from ${testFile}.`);

		if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
	});

	it("42. run <file>.z3 groups multiline object expressions and keeps processing later expressions", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _z3evalMode: boolean })._z3evalMode = true;

		const testFile = "test-eval-42.z3";
		const testFilePath = path.join((harness.session as unknown as { _cwd: string })._cwd, testFile);
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

		await harness.session.prompt(`run ${testFile}`);

		const localEvalMessages = harness.session.messages.filter(
			(message) => message.role === "custom" && (message as { customType?: string }).customType === "local-eval",
		) as Array<{ details?: { entries?: Array<{ query: string; result: string }> } }>;
		expect(localEvalMessages).toHaveLength(2);
		const objectEntry = localEvalMessages[0].details?.entries?.[0];
		expect(objectEntry?.query).toContain(`label: "scores"`);
		expect(objectEntry?.result).toContain("label: scores");
		expect(objectEntry?.result).toContain("note: brace { text }");
		expect(objectEntry?.result).toContain("| name | score |");
		expect(objectEntry?.result).toContain("| A | 1 |");
		expect(objectEntry?.result).toContain("| B | 2 |");
		expect(localEvalMessages[1].details?.entries?.[0]).toEqual({ query: "64 + 64", result: "128" });

		if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
	});

	it("43. run <file>.z3 executes prompt assignment blocks through focused Z3 first", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");
		const testFile = "test-eval-43.z3";
		const testFilePath = path.join((harness.session as unknown as { _cwd: string })._cwd, testFile);
		fs.writeFileSync(
			testFilePath,
			`prompt = {
  prompt: "1..3"
}`,
			"utf-8",
		);

		await harness.session.prompt(`run ${testFile}`);

		expect(promptSpy).not.toHaveBeenCalled();
		const localEvalMessages = harness.session.messages.filter(
			(message) => message.role === "custom" && (message as { customType?: string }).customType === "local-eval",
		) as Array<{ details?: { entries?: Array<{ query: string; result: string }> } }>;
		const result = localEvalMessages[0].details?.entries?.[0]?.result ?? "";
		expect(localEvalMessages[0].details?.entries?.[0]?.query).toBe("1..3");
		expect(result).toContain("| Index | Value |");
		expect(result).toContain("| 2 | 3 |");

		if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
	});

	it("44. run <file>.js reports prompt block schema errors through local eval", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const promptSpy = vi.spyOn(harness.session.agent, "prompt");
		const testFile = "test-eval-44.js";
		const testFilePath = path.join((harness.session as unknown as { _cwd: string })._cwd, testFile);
		fs.writeFileSync(
			testFilePath,
			`prompt = {
  name: "missing"
}`,
			"utf-8",
		);

		await harness.session.prompt(`run ${testFile}`);

		expect(promptSpy).not.toHaveBeenCalled();
		const lastMessage = harness.session.messages[harness.session.messages.length - 2] as {
			customType?: string;
			details?: { entries?: Array<{ query: string; result: string }> };
		};
		expect(lastMessage.customType).toBe("local-eval");
		expect(lastMessage.details?.entries?.[0]?.result).toContain(
			'Error: Prompt block must contain a "prompt" property.',
		);

		if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
	});

	it("45. run <file>.js reports invalid prompt values and inner expressions through local eval", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const testFile = "test-eval-45.js";
		const testFilePath = path.join((harness.session as unknown as { _cwd: string })._cwd, testFile);
		fs.writeFileSync(
			testFilePath,
			`prompt = {
  prompt: 123
}

prompt = {
  prompt: [
    "2 + 3",
    123
  ]
}

prompt = {
  prompt: ""
}

prompt = {
  prompt: "2 +"
}`,
			"utf-8",
		);

		await harness.session.prompt(`run ${testFile}`);

		const localEvalText = harness.session.messages
			.filter(
				(message) => message.role === "custom" && (message as { customType?: string }).customType === "local-eval",
			)
			.map((message) => getMessageText(message))
			.join("\n");
		expect(localEvalText).toContain('Error: Prompt block "prompt" property must be a string or array of strings.');
		expect(localEvalText).toContain("Error: Prompt block prompt entry 2 must be a string.");
		expect(localEvalText).toContain("Error: Prompt block prompt entries must not be empty.");
		expect(localEvalText).toContain("2 +\nError:");

		if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
	});

	it("46. run <file>.js reports unterminated prompt blocks without crashing", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const testFile = "test-eval-46.js";
		const testFilePath = path.join((harness.session as unknown as { _cwd: string })._cwd, testFile);
		fs.writeFileSync(
			testFilePath,
			`prompt = {
  prompt: "2 + 3"
`,
			"utf-8",
		);

		await harness.session.prompt(`run ${testFile}`);

		const localEvalText = harness.session.messages
			.filter(
				(message) => message.role === "custom" && (message as { customType?: string }).customType === "local-eval",
			)
			.map((message) => getMessageText(message))
			.join("\n");
		expect(localEvalText).toContain("Error: Invalid prompt block syntax:");

		if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
	});
	//Viraj's Code end
	//Viraj's code end
	//Viraj's code end
});
