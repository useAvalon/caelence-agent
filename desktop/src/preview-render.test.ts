import { describe, expect, test } from "bun:test";
import {
	renderMarkdown,
	renderPreviewHtml,
	resolvePreviewAsset,
	rewritePreviewAssets,
	sanitizePreviewHtml,
} from "./preview-render.ts";

describe("preview render", () => {
	test("renders markdown headings, lists, code, and tables", () => {
		const html = renderMarkdown(
			[
				"# Title",
				"",
				"A **bold** and `code` line with [docs](https://example.com).",
				"",
				"- one",
				"- two",
				"",
				"```ts",
				"const n = 1;",
				"```",
				"",
				"| Path | What |",
				"| --- | --- |",
				"| src/ | Runtime |",
			].join("\n"),
		);
		expect(html).toContain("<h1>Title</h1>");
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain("<code>code</code>");
		expect(html).toContain('<a href="https://example.com">docs</a>');
		expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
		expect(html).toContain("<pre><code>const n = 1;</code></pre>");
		expect(html).toContain("<th>Path</th>");
		expect(html).toContain("<td>Runtime</td>");
	});

	test("keeps raw HTML blocks and images", () => {
		const html = renderMarkdown(
			[
				'<p align="center">',
				'\t<img src="brand/logo/mark.svg" alt="Mark" />',
				"</p>",
				"",
				"See ![shot](docs/shot.png) next.",
			].join("\n"),
		);
		expect(html).toContain('<p align="center">');
		expect(html).toContain('src="brand/logo/mark.svg"');
		expect(html).toContain('<img src="docs/shot.png" alt="shot" />');
	});

	test("resolves and rewrites local assets", () => {
		expect(resolvePreviewAsset("README.md", "brand/logo/mark.svg")).toBe("brand/logo/mark.svg");
		expect(resolvePreviewAsset("docs/guide.md", "./shot.png")).toBe("docs/shot.png");
		expect(resolvePreviewAsset("docs/guide.md", "../shot.png")).toBe("shot.png");
		expect(resolvePreviewAsset("docs/guide.md", "../../secret.png")).toBeUndefined();
		expect(resolvePreviewAsset("README.md", "https://m8ven.ai/badge.png")).toBeUndefined();
		const html = rewritePreviewAssets(
			'<img src="brand/logo/mark.svg" /><source srcset="brand/logo/dark.png" />',
			"README.md",
			(rel) => `/bytes/${rel}`,
		);
		expect(html).toContain("/bytes/brand/logo/mark.svg");
		expect(html).toContain("/bytes/brand/logo/dark.png");
	});

	test("strips scripts and handlers from html", () => {
		const clean = sanitizePreviewHtml(
			'<p onclick="alert(1)">Hi</p><script>alert(1)</script><img src="javascript:alert(1)" />',
		);
		expect(clean).not.toContain("script");
		expect(clean).not.toContain("onclick");
		expect(clean).not.toContain("javascript:");
		expect(renderPreviewHtml("<h1>Hi</h1>", "html")).toContain("<h1>Hi</h1>");
	});
});
