import { describe, expect, test } from "bun:test";
import { COMPUTER_EVAL_TASKS } from "./tasks.ts";

describe("computer eval tasks", () => {
	test("defines eleven fixed tasks", () => {
		expect(COMPUTER_EVAL_TASKS).toHaveLength(11);
		expect(new Set(COMPUTER_EVAL_TASKS.map((item) => item.id)).size).toBe(11);
	});
});
