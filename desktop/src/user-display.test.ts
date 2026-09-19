import { describe, expect, test } from "bun:test";
import { composeUploadMessage } from "../../src/desktop/upload-message.ts";
import { userBubbleContent } from "./user-display.ts";

describe("user bubble display", () => {
	test("shows a document chip instead of the uploaded file text", () => {
		const composed = composeUploadMessage("can you add a title to this doc", [
			{
				name: "zeugg-design-handover.md",
				rel: ".harness/uploads/1-0-zeugg-design-handover.md",
				mime: "text/markdown",
				excerpt: "# Zeugg Design System — Handover\n\nDark, technical, precise.",
			},
		]);
		const shown = userBubbleContent(composed);
		expect(shown.text).toBe("can you add a title to this doc");
		expect(shown.text).not.toContain("Zeugg Design System");
		expect(shown.attachments).toEqual([
			{
				name: "zeugg-design-handover.md",
				mime: "",
				kind: "file",
			},
		]);
	});

	test("keeps live composer chips and still strips a dumped excerpt", () => {
		const composed = composeUploadMessage("edit this", [
			{
				name: "notes.md",
				rel: ".harness/uploads/9-0-notes.md",
				mime: "text/markdown",
				excerpt: "lots of notes",
			},
		]);
		const shown = userBubbleContent(composed, [
			{ name: "notes.md", mime: "text/markdown", kind: "file" },
		]);
		expect(shown.text).toBe("edit this");
		expect(shown.attachments).toEqual([{ name: "notes.md", mime: "text/markdown", kind: "file" }]);
	});
});
