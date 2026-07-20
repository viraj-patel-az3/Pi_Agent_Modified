//Viraj's code start
import { describe, expect, it } from "vitest";
import {
	FocusedExpressionSyntaxError,
	parseFocusedExpression,
	tryEvaluateFocusedExpression,
} from "../z3eval-expression.ts";

describe("focused z3eval-compatible expression evaluator", () => {
	it("1. parses integer literals", () => {
		expect(parseFocusedExpression("1")).toEqual({ type: "number", value: 1 });
	});

	it("2. parses decimal literals", () => {
		expect(parseFocusedExpression("10.5")).toEqual({ type: "number", value: 10.5 });
	});

	it("3. parses negative numbers", () => {
		expect(parseFocusedExpression("-25")).toEqual({
			type: "unary",
			operator: "-",
			operand: { type: "number", value: 25 },
		});
	});

	it("4. parses and evaluates percentage literals", () => {
		const result = tryEvaluateFocusedExpression("10%");
		expect(result).toEqual({ kind: "value", value: 0.1 });
	});

	it("5. evaluates ascending integer ranges", () => {
		const result = tryEvaluateFocusedExpression("1..10");
		expect(result).toEqual({ kind: "value", value: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
	});

	it("6. evaluates descending integer ranges", () => {
		const result = tryEvaluateFocusedExpression("5..1");
		expect(result).toEqual({ kind: "value", value: [5, 4, 3, 2, 1] });
	});

	it("7. rejects fractional range endpoints", () => {
		expect(() => tryEvaluateFocusedExpression("1.5..3")).toThrowError("Range endpoints must be finite integers");
	});

	it("8. rejects oversized ranges", () => {
		expect(() => tryEvaluateFocusedExpression("1..10001")).toThrowError(
			"Range size 10001 exceeds the local evaluation limit of 10000",
		);
	});

	it("9. rejects malformed percentages", () => {
		expect(() => tryEvaluateFocusedExpression("10%%")).toThrowError(/Unexpected token "%"/);
	});

	it("10. rejects unsupported function names", () => {
		expect(() => tryEvaluateFocusedExpression("COS(1)")).toThrowError('Unsupported function "COS"');
	});

	it("11. evaluates scalar SIN", () => {
		const result = tryEvaluateFocusedExpression("SIN(1)");
		expect(result).toEqual({ kind: "value", value: Math.sin(1) });
	});

	it("12. supports case-insensitive function names", () => {
		const result = tryEvaluateFocusedExpression("sin(1)");
		expect(result).toEqual({ kind: "value", value: Math.sin(1) });
	});

	it("13. vectorizes SIN across ranges", () => {
		const result = tryEvaluateFocusedExpression("SIN(1..10)");
		expect(result.kind).toBe("value");
		if (result.kind === "value" && Array.isArray(result.value)) {
			expect(result.value).toHaveLength(10);
		}
	});

	it("14. matches Math.sin for every vectorized SIN result", () => {
		const result = tryEvaluateFocusedExpression("SIN(1..10)");
		expect(result.kind).toBe("value");
		if (result.kind === "value" && Array.isArray(result.value)) {
			result.value.forEach((value, index) => {
				expect(value).toBeCloseTo(Math.sin(index + 1), 12);
			});
		}
	});

	it("15. keeps primitive SIN vectors as flat arrays", () => {
		const result = tryEvaluateFocusedExpression("SIN(1..3)");
		expect(result).toEqual({
			kind: "value",
			value: [Math.sin(1), Math.sin(2), Math.sin(3)],
		});
	});

	it("16. evaluates spreadsheet-style PMT", () => {
		const result = tryEvaluateFocusedExpression("PMT(10%,10,10000,0,1)");
		expect(result.kind).toBe("value");
		if (result.kind === "value") {
			expect(result.value).toBeCloseTo(-1479.5035898410138, 12);
		}
	});

	it("17. uses the zero-rate PMT formula", () => {
		const result = tryEvaluateFocusedExpression("PMT(0%,10,10000,0,1)");
		expect(result).toEqual({ kind: "value", value: -1000 });
	});

	it("18. rejects invalid nper values", () => {
		expect(() => tryEvaluateFocusedExpression("PMT(10%,0,10000,0,1)")).toThrowError("nper cannot be zero");
	});

	it("19. rejects invalid payment types", () => {
		expect(() => tryEvaluateFocusedExpression("PMT(10%,10,10000,0,2)")).toThrowError("type must be 0 or 1");
	});

	it("20. vectorizes PMT across nper ranges", () => {
		const result = tryEvaluateFocusedExpression("PMT(10%,10..20,10000,0,1)");
		expect(result.kind).toBe("value");
		if (result.kind === "value" && Array.isArray(result.value)) {
			expect(result.value).toHaveLength(11);
		}
	});

	it("21. returns PMT vectors as a single-column matrix", () => {
		const result = tryEvaluateFocusedExpression("PMT(10%,10..12,10000,0,1)");
		expect(result.kind).toBe("value");
		if (result.kind === "value") {
			expect(Array.isArray(result.value)).toBe(true);
			if (Array.isArray(result.value) && result.value.every((row) => Array.isArray(row))) {
				expect(result.value).toHaveLength(3);
				expect(result.value[0][0]).toBeCloseTo(-1479.5035898410138, 12);
				expect(result.value[1][0]).toBeCloseTo(-1399.6649274964961, 12);
				expect(result.value[2][0]).toBeCloseTo(-1334.2119554571566, 12);
			}
		}
	});

	it("22. never returns a Promise", () => {
		const result = tryEvaluateFocusedExpression("PMT(10%,10,10000,0,1)");
		expect(result).not.toBeInstanceOf(Promise);
	});

	it("23. leaves plain JavaScript arrays to the fallback path", () => {
		expect(tryEvaluateFocusedExpression("[10,20,30]")).toEqual({ kind: "unsupported" });
	});

	it("24. leaves ragged JavaScript arrays to the fallback path", () => {
		expect(tryEvaluateFocusedExpression("[[1],[2,3]]")).toEqual({ kind: "unsupported" });
	});

	it("25. rejects unsupported focused syntax without falling back", () => {
		expect(() => tryEvaluateFocusedExpression("SIN(1..3).value")).toThrowError(FocusedExpressionSyntaxError);
	});
});
//Viraj's code end
