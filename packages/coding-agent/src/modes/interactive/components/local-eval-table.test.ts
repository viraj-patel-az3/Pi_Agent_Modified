// Viraj's code start
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { LocalEvalTableComponent, type LocalEvalTableValue } from "./local-eval-table.ts";

describe("LocalEvalTableComponent", () => {
	it("renders bordered primitive and nested values within the available width", () => {
		const value: LocalEvalTableValue = {
			kind: "object",
			entries: [
				["title", { kind: "scalar", value: "line one\nline two" }],
				[
					"items",
					{
						kind: "array",
						presentation: "nested",
						items: [
							{ kind: "scalar", value: "α" },
							{ kind: "object", entries: [["state", { kind: "scalar", value: "ok" }]] },
						],
					},
				],
			],
		};
		const lines = new LocalEvalTableComponent(value).render(48);
		expect(lines.some((line) => line.includes("┌"))).toBe(true);
		expect(lines.some((line) => line.includes("└"))).toBe(true);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(48);
	});

	// Viraj's code start
	it("renders vectors, tables, and matrices without generated index or column headings", () => {
		const values: LocalEvalTableValue[] = [
			{
				kind: "array",
				presentation: "vector",
				items: [
					{ kind: "scalar", value: "1" },
					{ kind: "scalar", value: "2" },
				],
			},
			{
				kind: "table",
				headers: [
					{ kind: "scalar", value: "Name" },
					{ kind: "scalar", value: "Age" },
				],
				rows: [
					[
						{ kind: "scalar", value: "row-a" },
						{ kind: "scalar", value: "31" },
					],
				],
			},
			{
				kind: "matrix",
				rows: [
					[
						{ kind: "scalar", value: "1" },
						{ kind: "scalar", value: "2" },
					],
					[
						{ kind: "scalar", value: "3" },
						{ kind: "scalar", value: "4" },
					],
				],
			},
		];
		const output = values.map((value) => new LocalEvalTableComponent(value).render(48).join("\n"));
		expect(output[0]).toContain("│ 1 │ 2 │");
		expect(output[0]).not.toContain("Index");
		expect(output[1]).toContain("Name");
		expect(output[1]).toContain("row-a");
		expect(output[1]).not.toContain("Index");
		expect(output[2]).toContain("│ 1 │ 2 │");
		expect(output[2]).toContain("│ 3 │ 4 │");
		expect(output[2]).not.toContain("Row");
		expect(output[2]).not.toContain("Column");
		expect(output.every((text) => text.includes("┌") && text.includes("└"))).toBe(true);
		for (const text of output)
			for (const line of text.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(48);
	});
	// Viraj's code end
});
// Viraj's code end
