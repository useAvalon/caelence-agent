import { joinUploadDisplay, parseUploadDisplay } from "../../src/desktop/upload-message.ts";
import { type AttachmentPreview, attachmentKind } from "./composer-files.ts";

export function userBubbleContent(
	text: string,
	attachments: AttachmentPreview[] = [],
): { text: string; attachments: AttachmentPreview[]; suffix: string } {
	const shown = parseUploadDisplay(text);
	const chips =
		attachments.length > 0
			? attachments
			: shown.attachments.map((file) => ({
					name: file.name,
					mime: file.mime ?? "",
					kind: attachmentKind(file.name, file.mime ?? ""),
				}));
	return { text: shown.prompt, attachments: chips, suffix: shown.suffix };
}

export { joinUploadDisplay };
