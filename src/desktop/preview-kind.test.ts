import { describe, expect, test } from "bun:test";
import { fileExt, filePreviewKind, filePreviewMime } from "./preview-kind.ts";

describe("file preview kind", () => {
	test("classifies markdown, html, images, and text", () => {
		expect(filePreviewKind("README.md")).toBe("markdown");
		expect(filePreviewKind("docs/note.markdown")).toBe("markdown");
		expect(filePreviewKind("page.html")).toBe("html");
		expect(filePreviewKind("brand/logo.png")).toBe("image");
		expect(filePreviewKind("shot.JPEG")).toBe("image");
		expect(filePreviewKind("mark.svg")).toBe("image");
		expect(filePreviewKind("src/app.ts")).toBe("text");
	});

	test("maps image mime types", () => {
		expect(fileExt("a.b.PNG")).toBe("png");
		expect(filePreviewMime("wordmark.png")).toBe("image/png");
		expect(filePreviewMime("note.md")).toBeUndefined();
	});
});
