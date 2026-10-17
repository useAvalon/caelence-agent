import { describe, expect, test } from "bun:test";
import { aimPause, moveBerryPointer } from "./pointer.ts";

describe("overlay cursor", () => {
	test("pointer helpers are no-ops", async () => {
		const started = Date.now();
		await aimPause(280);
		await moveBerryPointer(12, 34);
		expect(Date.now() - started).toBeLessThan(80);
	});
});
