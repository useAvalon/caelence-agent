export interface QueuedMessage {
	id: string;
	text: string;
}

export function enqueueMessage(queue: QueuedMessage[], text: string, id: string): QueuedMessage[] {
	const trimmed = text.trim();
	if (!trimmed) return queue;
	return [...queue, { id, text: trimmed }];
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
