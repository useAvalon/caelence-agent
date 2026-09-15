import { describe, expect, test } from "bun:test";
import { enqueueMessage, removeQueued, setQueuedText, shiftQueue, updateQueued } from "./queue.ts";

describe("message queue", () => {
	test("enqueues trimmed text and drops empty", () => {
		expect(enqueueMessage([], "  ", "q-1")).toEqual([]);
		expect(enqueueMessage([], "  later  ", "q-1")).toEqual([{ id: "q-1", text: "later" }]);
	});

	test("enqueues attachments without text", () => {
		const file = new File(["hi"], "a.txt", { type: "text/plain" });
		const attachment = {
			id: "a1",
			name: "a.txt",
			mime: "text/plain",
			size: 2,
			kind: "file" as const,
			file,
		};
		expect(enqueueMessage([], "  ", "q-1", [attachment])).toEqual([
			{ id: "q-1", text: "", attachments: [attachment] },
		]);
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
