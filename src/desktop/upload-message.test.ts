import { describe, expect, test } from "bun:test";
import { composeUploadMessage, joinUploadDisplay, parseUploadDisplay } from "./upload-message.ts";

describe("upload message display", () => {
	test("strips an excerpted text file from the visible prompt", () => {
		const composed = composeUploadMessage("can you add a title to this doc", [
			{
				name: "zeugg-design-handover.md",
				rel: ".harness/uploads/1-0-zeugg-design-handover.md",
				mime: "text/markdown",
				excerpt: "# Zeugg Design System\n\nDark, technical, precise.",
				original: "~/Downloads/zeugg-design-handover.md",
			},
		]);
		expect(composed).toContain("# Zeugg Design System");
		const shown = parseUploadDisplay(composed);
		expect(shown.prompt).toBe("can you add a title to this doc");
		expect(shown.attachments).toEqual([
			{
				name: "zeugg-design-handover.md",
				rel: ".harness/uploads/1-0-zeugg-design-handover.md",
			},
		]);
		expect(shown.suffix).toContain("Attached `");
		expect(joinUploadDisplay("add a title", shown.suffix)).toContain("add a title");
		expect(joinUploadDisplay("add a title", shown.suffix)).toContain("# Zeugg Design System");
	});

	test("keeps a plain prompt unchanged", () => {
		expect(parseUploadDisplay("just a question")).toEqual({
			prompt: "just a question",
			attachments: [],
			suffix: "",
		});
	});

	test("parses a binary attachment without an excerpt", () => {
		const composed = composeUploadMessage("", [
			{
				name: "shot.png",
				rel: ".harness/uploads/2-0-shot.png",
				mime: "image/png",
			},
		]);
		expect(parseUploadDisplay(composed).attachments).toEqual([
			{
				name: "shot.png",
				rel: ".harness/uploads/2-0-shot.png",
				mime: "image/png",
			},
		]);
	});
});
