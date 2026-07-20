//Viraj's code start
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { Component } from "@earendil-works/pi-tui";
import { Box, Container, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import type { MessageRenderer } from "../../../core/extensions/types.ts";
import type { CustomMessage } from "../../../core/messages.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { AssistantMessageComponent } from "./assistant-message.ts";
import { UserMessageComponent } from "./user-message.ts";

//Viraj's code end

//Viraj's code start
interface LocalEvalEntry {
	query: string;
	result: string;
}

interface LocalEvalMessageDetails {
	entries: LocalEvalEntry[];
}
//Viraj's code end

/**
 * Component that renders a custom message entry from extensions.
 * Uses distinct styling to differentiate from user messages.
 */
export class CustomMessageComponent extends Container {
	private message: CustomMessage<unknown>;
	private customRenderer?: MessageRenderer;
	private box: Box;
	private customComponent?: Component;
	private markdownTheme: MarkdownTheme;
	private _expanded = false;

	constructor(
		message: CustomMessage<unknown>,
		customRenderer?: MessageRenderer,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
	) {
		super();
		this.message = message;
		this.customRenderer = customRenderer;
		this.markdownTheme = markdownTheme;

		this.addChild(new Spacer(1));

		// Create box with purple background (used for default rendering)
		this.box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));

		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	//Viraj's code start
	private _isLocalEvalDetails(details: unknown): details is LocalEvalMessageDetails {
		if (details === null || typeof details !== "object") {
			return false;
		}
		const entries = (details as { entries?: unknown }).entries;
		return (
			Array.isArray(entries) &&
			entries.every(
				(entry) =>
					entry !== null &&
					typeof entry === "object" &&
					typeof (entry as { query?: unknown }).query === "string" &&
					typeof (entry as { result?: unknown }).result === "string",
			)
		);
	}

	private _createLocalEvalAssistantMessage(result: string): AssistantMessage {
		return {
			role: "assistant",
			content: [{ type: "text", text: result }],
			api: "unknown",
			model: "local-eval",
			provider: "local",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: this.message.timestamp,
		};
	}
	//Viraj's code end

	private rebuild(): void {
		// Remove previous content component
		if (this.customComponent) {
			this.removeChild(this.customComponent);
			this.customComponent = undefined;
		}
		this.removeChild(this.box);

		// Try custom renderer first - it handles its own styling
		if (this.customRenderer) {
			try {
				const component = this.customRenderer(this.message, { expanded: this._expanded }, theme);
				if (component) {
					// Custom renderer provides its own styled component
					this.customComponent = component;
					this.addChild(component);
					return;
				}
			} catch {
				// Fall through to default rendering
			}
		}

		//Viraj's code start
		if (this.message.customType === "local-eval" && this._isLocalEvalDetails(this.message.details)) {
			const localEvalContainer = new Container();
			const { entries } = this.message.details;
			for (let index = 0; index < entries.length; index++) {
				const entry = entries[index];
				if (index > 0) {
					localEvalContainer.addChild(new Spacer(1));
				}
				localEvalContainer.addChild(new UserMessageComponent(entry.query, this.markdownTheme));
				localEvalContainer.addChild(
					new AssistantMessageComponent(
						this._createLocalEvalAssistantMessage(entry.result),
						false,
						this.markdownTheme,
					),
				);
			}
			this.customComponent = localEvalContainer;
			this.addChild(localEvalContainer);
			return;
		}
		//Viraj's code end

		// Default rendering uses our box
		this.addChild(this.box);
		this.box.clear();

		// Default rendering: label + content
		if (this.message.customType) {
			const label = theme.fg("customMessageLabel", `\x1b[1m[${this.message.customType}]\x1b[22m`);
			this.box.addChild(new Text(label, 0, 0));
			this.box.addChild(new Spacer(1));
		}

		// Extract text content
		let text: string;
		if (typeof this.message.content === "string") {
			text = this.message.content;
		} else {
			text = this.message.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		}

		this.box.addChild(
			new Markdown(text, 0, 0, this.markdownTheme, {
				color: (text: string) => theme.fg("customMessageText", text),
			}),
		);
	}
}
