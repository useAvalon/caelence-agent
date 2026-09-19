import type { ComposerAttachment } from "./composer-files.ts";

export interface QueuedMessage {
	id: string;
	text: string;
	attachments?: ComposerAttachment[];
}

export function enqueueMessage(
	queue: QueuedMessage[],
	text: string,
	id: string,
	attachments: ComposerAttachment[] = [],
): QueuedMessage[] {
	const trimmed = text.trim();
	if (!trimmed && attachments.length === 0) return queue;
	return [...queue, { id, text: trimmed, ...(attachments.length > 0 ? { attachments } : {}) }];
}

export function removeQueued(queue: QueuedMessage[], id: string): QueuedMessage[] {
	return queue.filter((item) => item.id !== id);
}

export function setQueuedText(queue: QueuedMessage[], id: string, text: string): QueuedMessage[] {
	return queue.map((item) => (item.id === id ? { ...item, text } : item));
}

export function updateQueued(queue: QueuedMessage[], id: string, text: string): QueuedMessage[] {
	const trimmed = text.trim();
	if (!trimmed) return removeQueued(queue, id);
	return queue.map((item) => (item.id === id ? { ...item, text: trimmed } : item));
}

export function shiftQueue(queue: QueuedMessage[]): {
	next?: QueuedMessage;
	rest: QueuedMessage[];
} {
	const [next, ...rest] = queue;
	return next ? { next, rest } : { rest };
}

export function promoteQueued(queue: QueuedMessage[], id: string): QueuedMessage[] {
	const index = queue.findIndex((item) => item.id === id);
	if (index <= 0) return queue;
	const item = queue[index];
	if (!item) return queue;
	return [item, ...queue.filter((row) => row.id !== id)];
}
