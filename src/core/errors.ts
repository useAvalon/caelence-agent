const HTML_BODY = /<!DOCTYPE\s+html|<html[\s>]/i;

export function isHtmlErrorMessage(message: string): boolean {
	return HTML_BODY.test(message);
}

function providerJsonMessage(raw: string): string | null {
	const start = raw.indexOf("{");
	if (start < 0) return null;
	try {
		const parsed = JSON.parse(raw.slice(start)) as {
			message?: unknown;
			error?: unknown;
		};
		if (typeof parsed.error === "object" && parsed.error !== null) {
			const inner = (parsed.error as { message?: unknown }).message;
			if (typeof inner === "string" && inner.trim()) return inner.trim();
		}
		if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
		if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
	} catch {
		return null;
	}
	return null;
}

/** Collapse HTML / nested-JSON provider failures into one chat-safe line. */
export function sanitizeAgentError(message: string): string {
	if (isHtmlErrorMessage(message)) {
		const status = /^(\d{3})\b/.exec(message.trim())?.[1];
		if (status) {
			return `The request returned HTTP ${status} (an HTML error page). Check the API URL and keys.`;
		}
		return "The request returned an HTML error page instead of a model response. Check the API URL and keys.";
	}
	const extracted = providerJsonMessage(message);
	if (extracted && extracted !== message.trim()) return extracted;
	return message;
}

export function errorMessage(err: unknown): string {
	let raw: string;
	if (err instanceof Error) raw = err.message;
	else if (typeof err === "string") raw = err;
	else if (err && typeof err === "object") {
		const rec = err as Record<string, unknown>;
		if (typeof rec.message === "string" && rec.message) raw = rec.message;
		else if (typeof rec.error === "string" && rec.error) raw = rec.error;
		else {
			try {
				const json = JSON.stringify(err);
				raw = json && json !== "{}" ? json : String(err);
			} catch {
				raw = String(err);
			}
		}
	} else {
		raw = String(err);
	}
	return sanitizeAgentError(raw);
}

export function isAbortError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const name = (err as { name?: unknown }).name;
	return name === "AbortError" || name === "CancelledError";
}
