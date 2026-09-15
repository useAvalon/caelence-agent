import { describe, expect, test } from "bun:test";
import { ENTER_ALT_SCREEN, enterAltScreen, LEAVE_ALT_SCREEN, SHOW_CURSOR } from "./tui-screen.ts";

describe("alternate screen", () => {
	test("is a no-op when stdout is not a TTY", () => {
		const writes: string[] = [];
		const stdout = {
			isTTY: false,
			write(chunk: string) {
				writes.push(chunk);
				return true;
			},
		} as unknown as NodeJS.WriteStream;
		const restore = enterAltScreen(stdout);
		restore();
		expect(writes).toEqual([]);
	});

	test("enters and leaves the alternate screen on a TTY", () => {
		const writes: string[] = [];
		const stdout = {
			isTTY: true,
			write(chunk: string) {
				writes.push(chunk);
				return true;
			},
		} as unknown as NodeJS.WriteStream;
		const restore = enterAltScreen(stdout);
		restore();
		expect(writes[0]).toBe(ENTER_ALT_SCREEN);
		expect(writes[1]).toBe(`${LEAVE_ALT_SCREEN}${SHOW_CURSOR}`);
	});
});
