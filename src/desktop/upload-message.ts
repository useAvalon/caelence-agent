export interface UploadMessageFile {
	name: string;
	rel: string;
	mime: string;
	excerpt?: string;
	original?: string;
}

export interface ParsedUploadAttachment {
	name: string;
	rel: string;
	mime?: string;
}

const ATTACHED_MARK = /^Attached `(\.harness\/uploads\/[^`]+)` /m;
const ATTACHED_BLOCK =
	/^Attached `(\.harness\/uploads\/[^`]+)` \(([^)]+)\)\.(?: Original: `([^`]+)`\.)?(?: Use that project path\.)?(?:\n\n```\n[\s\S]*?\n```)?/;

export function composeUploadMessage(text: string, files: UploadMessageFile[]): string {
	if (files.length === 0) return text;
	const blocks = files.map((file) => {
		const original = file.original ? ` Original: \`${file.original}\`.` : "";
		if (file.excerpt !== undefined) {
			return `Attached \`${file.rel}\` (${file.name}).${original}\n\n\`\`\`\n${file.excerpt}\n\`\`\``;
		}
		return `Attached \`${file.rel}\` (${file.name}, ${file.mime}).${original} Use that project path.`;
	});
	const body = text.trim();
	return body ? `${body}\n\n${blocks.join("\n\n")}` : blocks.join("\n\n");
}

export function parseUploadDisplay(text: string): {
	prompt: string;
	attachments: ParsedUploadAttachment[];
	suffix: string;
} {
	const match = ATTACHED_MARK.exec(text);
	if (!match || match.index === undefined) {
		return { prompt: text, attachments: [], suffix: "" };
	}
	const prompt = text.slice(0, match.index).trim();
	const suffix = text.slice(match.index).trim();
	return { prompt, attachments: parseAttachedBlocks(suffix), suffix };
}

export function joinUploadDisplay(prompt: string, suffix?: string): string {
	const body = prompt.trim();
	const extra = suffix?.trim() ?? "";
	if (!extra) return body;
	return body ? `${body}\n\n${extra}` : extra;
}

function parseAttachedBlocks(suffix: string): ParsedUploadAttachment[] {
	const attachments: ParsedUploadAttachment[] = [];
	let rest = suffix.trim();
	while (rest) {
		const match = ATTACHED_BLOCK.exec(rest);
		if (match == null) break;
		if (match.index !== 0) break;
		const rel = match[1] ?? "";
		const paren = match[2] ?? "";
		attachments.push({ rel, ...splitNameMime(paren) });
		rest = rest.slice(match[0].length).trimStart();
	}
	return attachments;
}

function splitNameMime(paren: string): { name: string; mime?: string } {
	const cut = paren.lastIndexOf(", ");
	if (cut > 0 && paren.slice(cut + 2).includes("/")) {
		return { name: paren.slice(0, cut), mime: paren.slice(cut + 2) };
	}
	return { name: paren };
}
