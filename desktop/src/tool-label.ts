/** Human labels for transcript tool rows, matching the builder event rows. */

const TOOL_LABELS: Record<string, string> = {
	get_preview_url: "Refreshing preview",
	search_avalon_docs: "Searching Avalon docs",
	get_component_pattern: "Fetching component pattern",
	get_doc: "Reading Avalon docs",
	list_docs: "Listing Avalon docs",
	validate_avalon_component: "Validating component",
	firecrawl_search: "Searching the web",
	web_search: "Searching the web",
	todo_write: "Updating todos",
	grep: "Searching files",
	glob: "Finding files",
};

const EVENT_COUNT_RE = /\s×(\d+)$/u;

export function prettifyToolName(name: string): string {
	const local = name.includes("__") ? (name.split("__").at(-1) ?? name) : name;
	const stripped = local.replace(/^[a-z0-9]+_/i, (prefix) => {
		const ns = name.split("__")[0];
		return ns && prefix.toLowerCase() === `${ns.toLowerCase()}_` ? "" : prefix;
	});
	const s = stripped.replace(/[_-]+/g, " ").trim();
	return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : name;
}

export function toolLabel(toolName: string, input: Record<string, unknown> = {}): string {
	const path = typeof input.path === "string" ? input.path : undefined;
	const command = typeof input.command === "string" ? input.command : undefined;
	if (toolName === "write_file" && path) return `Writing ${path}`;
	if (toolName === "edit_file" && path) return `Editing ${path}`;
	if (toolName === "read_file" && path) return `Reading ${path}`;
	if (toolName === "exec" && command) return `Running: ${command}`;
	const known = TOOL_LABELS[toolName];
	if (known) return known;
	const pretty = prettifyToolName(toolName);
	const ns = toolName.includes("__") ? toolName.split("__")[0] : undefined;
	if (ns && !pretty.toLowerCase().startsWith(ns.replace(/[_-]+/g, " ").toLowerCase())) {
		const host = ns.replace(/[_-]+/g, " ");
		const hostLabel = host.charAt(0).toUpperCase() + host.slice(1);
		return `${hostLabel} ${pretty.toLowerCase()}`;
	}
	return pretty;
}

export function inputFromPreview(preview: string): Record<string, unknown> {
	const raw = preview.trim();
	if (!raw) return {};
	if (raw.startsWith("{") || raw.startsWith("[")) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			return { label: raw };
		}
	}
	return { path: raw, command: raw, query: raw, label: raw };
}

export function eventCountSuffix(count: number): string {
	return count > 1 ? ` ×${count}` : "";
}

export function baseEventLabel(label: string): string {
	return label.replace(EVENT_COUNT_RE, "");
}
