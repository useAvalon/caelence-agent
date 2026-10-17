import { describe, expect, test } from "bun:test";
import { laterActionsUseRefs, signatureChanged } from "./batch.ts";
import { hintFor, PostconditionError, StaleRefError } from "./errors.ts";
import { executeOnPage, type MeasuredTarget, type PagePort, type PageSnap } from "./executor.ts";
import { parseBrowserActions } from "./parse-actions.ts";
import { PAGE_RUNTIME } from "./runtime.ts";

describe("page runtime", () => {
	test("parses as one expression and does not inject style or html", () => {
		expect(() => new Function(`return (${PAGE_RUNTIME})`)).not.toThrow();
		expect(PAGE_RUNTIME).not.toContain("innerHTML");
		expect(PAGE_RUNTIME).not.toContain('createElement("style")');
		expect(PAGE_RUNTIME).not.toContain("__name");
		expect(PAGE_RUNTIME).toContain("version: 3");
	});
});

describe("browser action parser", () => {
	test("accepts a role and name target", () => {
		const parsed = parseBrowserActions([
			{
				kind: "click",
				target: { role: "button", name: "Start a post" },
				label: "Opening the composer",
				expect: "dialog_opens",
			},
			{
				kind: "type",
				target: { role: "textbox", name: "creating content" },
				text: "Hello",
				label: "Writing the post",
			},
		]);
		expect(parsed.error).toBeUndefined();
		expect(parsed.actions[1]?.role).toBe("textbox");
		expect(parsed.actions[1]?.name).toBe("creating content");
	});

	test("uses the label when the click has no ref", () => {
		const parsed = parseBrowserActions([{ kind: "click", label: "Start a post" }]);
		expect(parsed.error).toBeUndefined();
		expect(parsed.actions[0]?.name).toBe("Start a post");
		expect(parsed.actions[0]?.role).toBe("button");
	});

	test("does not treat a type label as a field name", () => {
		const parsed = parseBrowserActions([
			{ kind: "type", text: "Hello", label: "type post content" },
		]);
		expect(parsed.error).toBeUndefined();
		expect(parsed.actions[0]?.name).toBeUndefined();
		expect(parsed.actions[0]?.text).toBe("Hello");
	});

	test("reads a ref passed as the target string", () => {
		const parsed = parseBrowserActions([
			{ kind: "click", target: "n32", label: "click post textbox" },
		]);
		expect(parsed.error).toBeUndefined();
		expect(parsed.actions[0]?.ref).toBe("n32");
		expect(parsed.actions[0]?.name).toBeUndefined();
	});

	test("treats a key action as a press", () => {
		const parsed = parseBrowserActions([{ kind: "press_key", key: "Enter", label: "Go" }]);
		expect(parsed.error).toBeUndefined();
		expect(parsed.actions[0]?.kind).toBe("press");
		expect(parsed.actions[0]?.key).toBe("Enter");
	});

	test("rejects an unknown kind and a click with no target", () => {
		expect(parseBrowserActions([{ kind: "hover", label: "nope" }]).error).toContain("unknown kind");
		expect(parseBrowserActions([{ kind: "click" }]).error).toContain("needs a ref");
	});
});

describe("batch stop", () => {
	test("stops ref actions after a modal opens and keeps role targets", () => {
		const before = { modal: false, count: 20, url: "https://www.linkedin.com/feed/" };
		const after = { modal: true, count: 6, url: before.url };
		expect(signatureChanged(before, after)).toBe(true);
		const actions = [
			{ kind: "click" as const, ref: "2", label: "Start" },
			{ kind: "type" as const, ref: "4", text: "Hi", label: "Type" },
		];
		expect(laterActionsUseRefs(actions, 0)).toBe(true);
		const semantic = [
			{ kind: "click" as const, role: "button", name: "Start a post", label: "Start" },
			{
				kind: "type" as const,
				role: "textbox",
				name: "creating content",
				text: "Hi",
				label: "Type",
			},
		];
		expect(laterActionsUseRefs(semantic, 0)).toBe(false);
	});
});

describe("action hints", () => {
	test("maps typed errors to a model hint", () => {
		expect(hintFor(new StaleRefError("gone"))).toContain("role and name");
		expect(hintFor(new PostconditionError("no dialog"))).toContain("expected effect");
	});
});

describe("page executor", () => {
	test("continues a semantic batch after the composer opens", async () => {
		const port = fakePage();
		const result = await executeOnPage(
			port,
			[
				{
					kind: "click",
					role: "button",
					name: "Start a post",
					label: "Opening the composer",
					expect: "dialog_opens",
				},
				{
					kind: "type",
					role: "textbox",
					name: "creating content",
					text: "Hello berry",
					label: "Writing the post",
					expect: "text_equals",
				},
			],
			{ stableMs: 0, moveCursor: async () => undefined },
		);
		expect(result.stopped).toBeUndefined();
		expect(port.text).toBe("Hello berry");
		expect(result.observation).toContain("MODAL OPEN");
	});

	test("skips a stale ref after the page changes", async () => {
		const port = fakePage();
		const result = await executeOnPage(
			port,
			[
				{ kind: "click", role: "button", name: "Start a post", label: "Opening the composer" },
				{ kind: "type", ref: "4", text: "too late", label: "Writing the post" },
			],
			{ stableMs: 0, moveCursor: async () => undefined },
		);
		expect(result.stopped).toBeUndefined();
		expect(result.observation).toContain("Remaining 1 actions skipped");
		expect(port.text).toBe("");
	});
});

function fakePage(): PagePort & { text: string } {
	let modal = false;
	let text = "";
	const button: MeasuredTarget = {
		ok: true,
		x: 8,
		y: 8,
		width: 120,
		height: 32,
		screenX: 40,
		screenY: 40,
		role: "button",
		name: "Start a post",
		hittable: true,
		focused: false,
	};
	const editor: MeasuredTarget = {
		...button,
		y: 80,
		height: 120,
		role: "textbox",
		name: "Text editor for creating content",
		focused: true,
	};
	const closed: PageSnap = {
		text: 'URL: http://127.0.0.1:4321/\n[1] button "Start a post"',
		meta: {},
		count: 12,
		modal: false,
		url: "http://127.0.0.1:4321/",
		focused: false,
	};
	const port: PagePort & { text: string } = {
		get text() {
			return text;
		},
		async evaluate<T>(expression: string): Promise<T> {
			if (expression.includes("__agOps.snap")) {
				const open: PageSnap = {
					text: 'URL: http://127.0.0.1:4321/\nMODAL OPEN: "Create a post". Only modal contents are listed; the page behind is blocked.\n[1] textbox "Text editor for creating content" (empty editor, focused)',
					meta: { "1": { role: "textbox", name: "Text editor for creating content" } },
					count: 2,
					modal: true,
					url: closed.url,
					focused: true,
				};
				return (modal ? open : closed) as T;
			}
			if (expression.includes("__agOps.measure")) return (modal ? editor : button) as T;
			if (expression.includes("__agOps.clickElement")) {
				modal = true;
				return { ok: true } as T;
			}
			if (expression.includes("focusState") || expression.includes("__agOps.focus")) {
				return { inside: true, ok: true } as T;
			}
			if (expression.includes("__agOps.clear"))
				return { ok: true, skipped: text.length === 0 } as T;
			if (expression.includes("__agOps.read")) return text as T;
			if (expression.includes("__agOps.insert")) return { ok: true } as T;
			if (expression.includes("typeahead")) return false as T;
			if (expression.includes("modalCount")) return (modal ? 1 : 0) as T;
			if (expression.includes("diagnostics")) {
				return { overlay: { connected: true, w: 18, h: 18, opacity: 1, inTopLayer: true } } as T;
			}
			return "ok" as T;
		},
		async clickAt() {
			modal = true;
		},
		async typeChars(value) {
			text += value;
		},
	};
	return port;
}
