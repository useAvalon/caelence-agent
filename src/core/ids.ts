/** Prefixed random id (`ses_…`, `call_…`). */
export function newId(prefix: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `${prefix}_${hex}`;
}
