import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	composeUploadMessage,
	isTextUpload,
	listUploads,
	matchUploadEdit,
	parseIncomingUploads,
	safeUploadName,
	saveUploads,
} from "./uploads.ts";

describe("uploads", () => {
	test("parses named base64 attachments and ignores junk", () => {
		expect(
			parseIncomingUploads([
				{ name: " a.txt ", mime: "text/plain", data: "YQ==" },
				{ name: "", data: "YQ==" },
				{ mime: "text/plain", data: "YQ==" },
				"nope",
			]),
		).toEqual([{ name: "a.txt", mime: "text/plain", data: "YQ==" }]);
		expect(
			parseIncomingUploads([
				{ name: "cv.md", mime: "text/markdown", data: "YQ==", sourcePath: "/Users/mads/cv.md" },
			])[0]?.sourcePath,
		).toBe("/Users/mads/cv.md");
	});

	test("treats source and markdown as text", () => {
		expect(isTextUpload("notes.md", "application/octet-stream")).toBe(true);
		expect(isTextUpload("shot.png", "image/png")).toBe(false);
		expect(isTextUpload("data.json", "application/json")).toBe(true);
	});

	test("sanitizes upload names", () => {
		expect(safeUploadName("../weird name!.png")).toBe("weird_name_.png");
		expect(safeUploadName("...")).toBe("file");
	});

	test("writes files and composes a message with text excerpts", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-uploads-"));
		try {
			const saved = saveUploads(cwd, [
				{ name: "note.txt", mime: "text/plain", data: Buffer.from("hello").toString("base64") },
				{ name: "shot.png", mime: "image/png", data: Buffer.from([0x89, 0x50]).toString("base64") },
			]);
			expect(saved).toHaveLength(2);
			expect(saved[0]?.rel.startsWith(".harness/uploads/")).toBe(true);
			expect(saved[0]?.excerpt).toBe("hello");
			expect(saved[1]?.excerpt).toBeUndefined();
			const body = await readFile(join(cwd, saved[0]?.rel ?? ""), "utf8");
			expect(body).toBe("hello");
			expect(composeUploadMessage("look", saved)).toContain("look");
			expect(composeUploadMessage("look", saved)).toContain(saved[0]?.rel ?? "");
			expect(composeUploadMessage("look", saved)).toContain("```\nhello\n```");
			expect(composeUploadMessage("", saved)).toContain(saved[1]?.rel ?? "");
			expect(listUploads(cwd).map((item) => item.name)).toEqual(["shot.png", "note.txt"]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("keeps the original path and matches it for edit prompts", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-uploads-"));
		const original = join(cwd, "source.md");
		try {
			await Bun.write(original, "draft");
			const saved = saveUploads(cwd, [
				{
					name: "source.md",
					mime: "text/markdown",
					data: Buffer.from("draft").toString("base64"),
					sourcePath: original,
				},
			]);
			expect(saved[0]?.sourcePath).toBe(original);
			expect(composeUploadMessage("edit", saved)).toContain("Original:");
			expect(matchUploadEdit(cwd, saved[0]?.rel ?? "")).toEqual({
				rel: saved[0]?.rel ?? "",
				sourcePath: original,
				name: "source.md",
			});
			expect(matchUploadEdit(cwd, original)?.rel).toBe(saved[0]?.rel);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
