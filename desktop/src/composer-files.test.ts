import { describe, expect, test } from "bun:test";
import {
	attachmentKind,
	createAttachment,
	droppedPaths,
	fileExtension,
	filesFromTransfer,
	mergeAttachments,
	transferHasFiles,
} from "./composer-files.ts";

describe("composer files", () => {
	test("classifies images, video, and other files", () => {
		expect(attachmentKind("shot.PNG", "")).toBe("image");
		expect(attachmentKind("clip.mp4", "video/mp4")).toBe("video");
		expect(attachmentKind("notes.md", "text/markdown")).toBe("file");
	});

	test("reads a short extension label", () => {
		expect(fileExtension("Brief.PDF")).toBe("PDF");
		expect(fileExtension("noext")).toBe("FILE");
	});

	test("detects a file drag payload", () => {
		expect(transferHasFiles({ types: ["Files"] } as DataTransfer)).toBe(true);
		expect(transferHasFiles({ types: ["text/plain"] } as DataTransfer)).toBe(false);
		expect(transferHasFiles(null)).toBe(false);
	});

	test("reads files and native paths from a drop", () => {
		const file = new File(["hi"], "a.txt", { type: "text/plain" });
		Object.assign(file, { path: "/tmp/a.txt" });
		const transfer = { files: [file] } as unknown as DataTransfer;
		expect(filesFromTransfer(transfer).map((item) => item.name)).toEqual(["a.txt"]);
		expect(droppedPaths(transfer)).toEqual(["/tmp/a.txt"]);
		expect(createAttachment(file).sourcePath).toBe("/tmp/a.txt");
	});

	test("merges unique files and rejects oversized extras", () => {
		const first = new File(["hello"], "a.txt", { type: "text/plain", lastModified: 1 });
		const same = new File(["hello"], "a.txt", { type: "text/plain", lastModified: 1 });
		const extra = new File(["world"], "b.txt", { type: "text/plain", lastModified: 2 });
		const huge = new File([new Uint8Array(11 * 1024 * 1024)], "big.bin", { lastModified: 3 });
		const merged = mergeAttachments([], [first, same, extra, huge]);
		expect(merged.attachments.map((item) => item.name)).toEqual(["a.txt", "b.txt"]);
		expect(merged.rejected).toEqual(["big.bin"]);
	});
});
