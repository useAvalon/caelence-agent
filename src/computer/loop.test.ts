import { describe, expect, test } from "bun:test";
import type { MainModelProvider, ProviderStreamEvent } from "../core/events.ts";
import { runComputerLoop } from "./loop.ts";
import type { ComputerRuntime } from "./tools.ts";

describe("computer loop", () => {
	test("one model call can batch actions then finish", async () => {
		let observed = 0;
		let acted = 0;
		const runtime: ComputerRuntime = {
			async observe() {
				observed += 1;
				return 'URL https://example.com\n1 textbox "Search"';
			},
			async act(actions) {
				acted += actions.length;
				return { observation: 'URL https://example.com\n1 textbox "Search" [focused]' };
			},
			async run() {
				return "ok";
			},
			async askUser(question) {
				return question;
			},
		};
		const first: ProviderStreamEvent[] = [
			{
				type: "tool_call",
				id: "1",
				name: "act",
				input: {
					actions: [
						{ kind: "click", ref: "1", label: "Search" },
						{ kind: "type", ref: "1", text: "hi", label: "type" },
					],
				},
			},
		];
		const second: ProviderStreamEvent[] = [
			{ type: "tool_call", id: "2", name: "done", input: { summary: "Typed hi.", success: true } },
		];
		let round = 0;
		const model: MainModelProvider = {
			kind: "test",
			modelId: "test",
			async *stream() {
				round += 1;
				yield* round === 1 ? first : second;
			},
		};
		const result = await runComputerLoop({
			task: "type hi in search",
			tier: 1,
			provider: model,
			runtime,
		});
		expect(acted).toBe(2);
		expect(observed).toBe(0);
		expect(result.summary).toBe("Typed hi.");
		expect(result.success).toBe(true);
		expect(result.turns).toBe(2);
	});

	test("refuses done before any screen action", async () => {
		let acted = 0;
		const runtime: ComputerRuntime = {
			async observe() {
				return 'URL https://example.com\n1 button "Start a post"';
			},
			async act(actions) {
				acted += actions.length;
				return { observation: 'URL https://example.com\n1 textbox "Post"' };
			},
			async run() {
				return "ok";
			},
			async askUser(question) {
				return question;
			},
		};
		let round = 0;
		const model: MainModelProvider = {
			kind: "test",
			modelId: "test",
			async *stream() {
				round += 1;
				if (round === 1) {
					yield {
						type: "tool_call",
						id: "d1",
						name: "done",
						input: { summary: "I pasted the post.", success: true },
					};
					return;
				}
				if (round === 2) {
					yield {
						type: "tool_call",
						id: "a1",
						name: "act",
						input: { actions: [{ kind: "click", ref: "1", label: "Open the field" }] },
					};
					return;
				}
				if (round === 3) {
					yield {
						type: "tool_call",
						id: "d2",
						name: "done",
						input: { summary: "It's in the composer.", success: true },
					};
					return;
				}
				if (round === 4) {
					yield {
						type: "tool_call",
						id: "a2",
						name: "act",
						input: {
							actions: [{ kind: "type", ref: "2", text: "Hello", label: "Typing" }],
						},
					};
					return;
				}
				yield {
					type: "tool_call",
					id: "d3",
					name: "done",
					input: { summary: "Typed the text.", success: true },
				};
			},
		};
		const result = await runComputerLoop({
			task: "draft a post",
			tier: 1,
			provider: model,
			runtime,
		});
		expect(acted).toBe(2);
		expect(result.summary).toBe("Typed the text.");
	});
});
