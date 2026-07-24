// Viraj's code start
import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type LocalEvalTableValue =
	| { kind: "scalar"; value: string }
	// Viraj's code start
	| { kind: "array"; presentation: "vector" | "nested"; items: LocalEvalTableValue[] }
	| { kind: "table"; headers: LocalEvalTableValue[]; rows: LocalEvalTableValue[][] }
	| { kind: "matrix"; rows: LocalEvalTableValue[][] }
	// Viraj's code end
	| { kind: "object"; entries: Array<[string, LocalEvalTableValue]> }
	| { kind: "marker"; value: string };

type RenderedValue = { lines: string[]; width: number };

function pad(line: string, width: number): string {
	return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}

function scalarLines(value: string, width: number): string[] {
	return wrapTextWithAnsi(value || " ", Math.max(1, width));
}

// Viraj's code start
function table(headers: string[] | undefined, rows: string[][], width: number): string[] {
	const columns = headers?.length ?? Math.max(1, ...rows.map((row) => row.length));
	const overhead = columns * 3 + 1;
	const available = Math.max(columns, width - overhead);
	const natural = Array.from({ length: columns }, (_item, index) =>
		Math.max(
			1,
			...(headers ? [visibleWidth(headers[index] ?? "")] : []),
			...rows.map((row) => visibleWidth(row[index] ?? "")),
		),
	);
	let columnWidths = [...natural];
	const total = natural.reduce((sum, item) => sum + item, 0);
	if (total > available) {
		columnWidths = natural.map(() => 1);
		let remaining = available - columns;
		for (let index = 0; remaining > 0; index = (index + 1) % columns) {
			if (columnWidths[index] < natural[index]) {
				columnWidths[index]++;
				remaining--;
			}
		}
	}
	const divider = `├─${columnWidths.map((item) => "─".repeat(item)).join("─┼─")}─┤`;
	const renderRow = (cells: string[]): string[] => {
		const wrapped = cells.map((cell, index) => scalarLines(cell, columnWidths[index]));
		const height = Math.max(...wrapped.map((cell) => cell.length));
		return Array.from(
			{ length: height },
			(_item, lineIndex) =>
				`│ ${wrapped.map((cell, index) => pad(cell[lineIndex] ?? "", columnWidths[index])).join(" │ ")} │`,
		);
	};
	const body = rows.flatMap((row, index) => [...renderRow(row), ...(index < rows.length - 1 ? [divider] : [])]);
	return [
		`┌─${columnWidths.map((item) => "─".repeat(item)).join("─┬─")}─┐`,
		...(headers ? [...renderRow(headers), divider] : []),
		...body,
		`└─${columnWidths.map((item) => "─".repeat(item)).join("─┴─")}─┘`,
	];
}
// Viraj's code end

function renderValue(value: LocalEvalTableValue, width: number, depth = 0): RenderedValue {
	if (value.kind === "scalar" || value.kind === "marker") {
		const lines = scalarLines(value.value, width);
		return { lines, width: Math.max(...lines.map(visibleWidth)) };
	}
	if (depth >= 5) return renderValue({ kind: "marker", value: "Maximum display depth reached" }, width, depth);
	// Viraj's code start
	if (value.kind === "table" || value.kind === "matrix") {
		const childWidth = Math.max(12, Math.floor(width * 0.58));
		const toCell = (cell: LocalEvalTableValue): string => {
			if (cell.kind === "scalar" || cell.kind === "marker") return cell.value;
			return renderValue(cell, childWidth, depth + 1).lines.join("\n");
		};
		const headers = value.kind === "table" ? value.headers.map(toCell) : undefined;
		const rows = value.rows.map((row) => row.map(toCell));
		const lines = table(headers, rows, width);
		return { lines, width: Math.max(...lines.map(visibleWidth)) };
	}
	// Viraj's code end

	if (value.kind === "array") {
		// Viraj's code start
		if (value.presentation === "vector") {
			if (value.items.length === 0) return renderValue({ kind: "scalar", value: "[]" }, width, depth);
			const cells = value.items.map((item) =>
				item.kind === "scalar" || item.kind === "marker"
					? item.value
					: renderValue(item, width, depth + 1).lines.join("\n"),
			);
			const lines = table(undefined, [cells], width);
			return { lines, width: Math.max(...lines.map(visibleWidth)) };
		}
		// Viraj's code end
		const childWidth = Math.max(12, Math.floor(width * 0.58));
		const rows: string[][] = [];
		const sections: string[][] = [];
		for (const [index, item] of value.items.entries()) {
			if (item.kind === "scalar" || item.kind === "marker") {
				rows.push([String(index), item.value]);
				continue;
			}
			const child = renderValue(item, childWidth, depth + 1);
			if (child.width <= childWidth) {
				rows.push([String(index), child.lines.join("\n")]);
			} else {
				const label = `Item ${index + 1}`;
				rows.push([String(index), `See ${label}`]);
				sections.push([label, ...child.lines]);
			}
		}
		const lines = [...table(["Index", "Value"], rows, width), ...sections.flatMap((section) => ["", ...section])];
		return { lines, width: Math.max(...lines.map(visibleWidth)) };
	}

	const primitive = value.entries.every(([, entry]) => entry.kind === "scalar" || entry.kind === "marker");
	if (primitive && value.entries.length > 0) {
		const headers = value.entries.map(([key]) => key);
		const rows = [
			value.entries.map(([, entry]) => (entry.kind === "scalar" || entry.kind === "marker" ? entry.value : "")),
		];
		const lines = table(headers, rows, width);
		return { lines, width: Math.max(...lines.map(visibleWidth)) };
	}
	const childWidth = Math.max(12, Math.floor(width * 0.58));
	const rows: string[][] = [];
	const sections: string[][] = [];
	for (const [key, item] of value.entries) {
		if (item.kind === "scalar" || item.kind === "marker") {
			rows.push([key, item.value]);
			continue;
		}
		const child = renderValue(item, childWidth, depth + 1);
		if (child.width <= childWidth) {
			rows.push([key, child.lines.join("\n")]);
		} else {
			const label = `${key} 1`;
			rows.push([key, `See ${label}`]);
			sections.push([label, ...child.lines]);
		}
	}
	const lines = [...table(["Field", "Value"], rows, width), ...sections.flatMap((section) => ["", ...section])];
	return { lines, width: Math.max(...lines.map(visibleWidth)) };
}

export class LocalEvalTableComponent implements Component {
	private readonly value: LocalEvalTableValue;

	constructor(value: LocalEvalTableValue) {
		this.value = value;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return renderValue(this.value, Math.max(10, width)).lines.map((line) =>
			pad(line, Math.min(width, visibleWidth(line))),
		);
	}
}
// Viraj's code end
