import { describe, expect, test } from "bun:test";
import { enqueueMessage, removeQueued, setQueuedText, shiftQueue, updateQueued } from "./queue.ts";

describe("message queue", () => {
	test("enqueues trimmed text and drops empty", () => {
		expect(enqueueMessage([], "  ", "q-1")).toEqual([]);
		expect(enqueueMessage([], "  later  ", "q-1")).toEqual([{ id: "q-1", text: "later" }]);
	});

	test("updates, removes, and shifts in order", () => {
		let queue = enqueueMessage([], "one", "q-1");
		queue = enqueueMessage(queue, "two", "q-2");
		queue = updateQueued(queue, "q-1", "one edited");
		expect(queue.map((item) => item.text)).toEqual(["one edited", "two"]);
		queue = setQueuedText(queue, "q-2", "two  ");
		expect(queue[1]?.text).toBe("two  ");
		queue = removeQueued(queue, "q-2");
		const shifted = shiftQueue(queue);
		expect(shifted.next?.text).toBe("one edited");
		expect(shifted.rest).toEqual([]);
	});
});
