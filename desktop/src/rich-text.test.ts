import { describe, expect, test } from "bun:test";
import { canvaViewUrl, isImageUrl, linkLabel, splitRichText } from "./rich-text.ts";

describe("splitRichText", () => {
	test("turns a Canva document-image URL into a preview", () => {
		const src =
			"https://media.canva.com/v2/document-image/hash:2114610722/height:532/id:DAHTOpj1Mso/type:B/width:376?brand=x";
		const parts = splitRichText(`Preview:\n${src}`);
		expect(parts[0]).toEqual({ type: "text", text: "Preview:\n" });
		expect(parts[1]).toEqual({ type: "image", src, alt: "Preview" });
		expect(isImageUrl(src)).toBe(true);
	});

	test("decodes HTML-escaped query ampersands in Canva URLs", () => {
		const parts = splitRichText(
			"Preview:\nhttps://media.canva.com/v2/document-image/id:abc?sig=one&amp;exp=two",
		);
		expect(parts[1]).toMatchObject({
			type: "image",
			src: "https://media.canva.com/v2/document-image/id:abc?sig=one&exp=two",
		});
	});

	test("turns Edit and View Canva URLs into clickable links", () => {
		const parts = splitRichText(
			"Edit: https://www.canva.com/d/K4tAORuznFyHJOx\nView: https://www.canva.com/d/zB----6zs2unkjaV",
		);
		const links = parts.filter((part) => part.type === "link");
		expect(links).toHaveLength(2);
		expect(links[0]).toMatchObject({
			type: "link",
			href: "https://www.canva.com/d/K4tAORuznFyHJOx",
			label: "www.canva.com/d/K4tAORuznFyHJOx",
		});
		expect(linkLabel("https://www.canva.com/d/K4tAORuznFyHJOx")).toBe(
			"www.canva.com/d/K4tAORuznFyHJOx",
		);
	});

	test("builds a Canva view URL from a document-image or /d/ link", () => {
		expect(canvaViewUrl("https://www.canva.com/d/zB----6zs2unkjaV")).toBe(
			"https://www.canva.com/d/zB----6zs2unkjaV",
		);
		expect(
			canvaViewUrl("https://media.canva.com/v2/document-image/hash:1/id:DAHTOpj1Mso/type:B?sig=x"),
		).toBe("https://www.canva.com/design/DAHTOpj1Mso/view");
	});

	test("keeps markdown links and surrounding copy", () => {
		const parts = splitRichText("See [the file](https://www.canva.com/d/abc) next.");
		expect(parts).toEqual([
			{ type: "text", text: "See " },
			{ type: "link", href: "https://www.canva.com/d/abc", label: "the file" },
			{ type: "text", text: " next." },
		]);
	});

	test("turns listed local files into openable paths", () => {
		const parts = splitRichText(
			"Latest files in ~/Downloads (newest first):\n\n1. Figma.dmg — Sep 15, 14:34\n2. favicon-agent-bg-32.svg — Sep 15, 09:05\n6. CV_Mads_Hærup_14-09-2026.pdf — Sep 14, 15:17",
		);
		const files = parts.filter((part) => part.type === "file");
		expect(files).toEqual([
			{ type: "file", path: "~/Downloads", label: "~/Downloads" },
			{ type: "file", path: "~/Downloads/Figma.dmg", label: "Figma.dmg" },
			{
				type: "file",
				path: "~/Downloads/favicon-agent-bg-32.svg",
				label: "favicon-agent-bg-32.svg",
			},
			{
				type: "file",
				path: "~/Downloads/CV_Mads_Hærup_14-09-2026.pdf",
				label: "CV_Mads_Hærup_14-09-2026.pdf",
			},
		]);
	});

	test("keeps an explicit home path clickable", () => {
		const parts = splitRichText("Open ~/Documents/brief.md when you can.");
		expect(parts.some((part) => part.type === "file" && part.path === "~/Documents/brief.md")).toBe(
			true,
		);
	});
});
