const SENSITIVE_KEY =
	/^(authorization|cookie|set-cookie|x-api-key|api[_-]?key|secret|passwd|password|token|access[_-]?token|refresh[_-]?token|private[_-]?key|database[_-]?url|connection[_-]?string|credit[_-]?card|card[_-]?number|cvv|cvc|ssn|stripe[_-]?key)$/i;

const SENSITIVE_VALUE =
	/(sk-[a-zA-Z0-9_-]{8,}|pk_(live|test)_[a-zA-Z0-9]+|Bearer\s+\S+|postgres(ql)?:\/\/\S+|mysql:\/\/\S+|mongodb(\+srv)?:\/\/\S+)/i;

const REDACTED = "[redacted]";
const MAX_STRING = 8_000;
const MAX_ARRAY = 40;
const MAX_KEYS = 80;
const MAX_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactString(value: string): string {
	const trimmed = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
	return SENSITIVE_VALUE.test(trimmed) ? REDACTED : trimmed;
}

function walk(value: unknown, depth: number): unknown {
	if (value == null) return value;
	if (typeof value === "string") return redactString(value);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return value.toString();
	if (typeof value !== "object") return String(value);
	if (depth >= MAX_DEPTH) return "[truncated]";
	if (Array.isArray(value)) {
		return value.slice(0, MAX_ARRAY).map((item) => walk(item, depth + 1));
	}
	if (!isPlainObject(value)) return String(value);
	const out: Record<string, unknown> = {};
	let count = 0;
	for (const [key, nested] of Object.entries(value)) {
		if (count >= MAX_KEYS) {
			out._truncated = true;
			break;
		}
		count += 1;
		if (SENSITIVE_KEY.test(key)) {
			out[key] = REDACTED;
			continue;
		}
		out[key] = walk(nested, depth + 1);
	}
	return out;
}

/** Strip secrets and cap payload size before sending to an observability backend. */
export function sanitize(value: unknown): unknown {
	try {
		return walk(value, 0);
	} catch {
		return "[unserializable]";
	}
}
