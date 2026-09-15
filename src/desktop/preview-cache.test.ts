import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	previewCacheKey,
	readPreviewCache,
	stablePreviewKey,
	writePreviewCache,
} from "./preview-cache.ts";

describe("preview cache", () => {
	test("keys Canva document images by design id, not the signed query", () => {
		const a = "https://media.canva.com/v2/document-image/hash:1/id:DAHTOpj1Mso/type:B?sig=old";
		const b = "https://media.canva.com/v2/document-image/hash:2/id:DAHTOpj1Mso/type:B?sig=new";
		expect(stablePreviewKey(a)).toBe("canva:DAHTOpj1Mso");
		expect(previewCacheKey(a)).toBe(previewCacheKey(b));
	});

	test("round-trips bytes under HARNESS_HOME", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-prev-"));
		const prev = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			const href = "https://media.canva.com/v2/document-image/id:abc/type:B";
			writePreviewCache(href, "image/png", new Uint8Array([1, 2, 3, 4]));
			const stored = readPreviewCache(href);
			expect(stored?.type).toBe("image/png");
			expect(Array.from(stored?.bytes ?? [])).toEqual([1, 2, 3, 4]);
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			await rm(home, { recursive: true, force: true });
		}
	});
});
