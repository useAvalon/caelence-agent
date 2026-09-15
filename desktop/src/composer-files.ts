import { blobToBase64 } from "./dictation.ts";

export const MAX_COMPOSER_FILES = 8;
export const MAX_COMPOSER_FILE_BYTES = 10 * 1024 * 1024;

export type ComposerFileKind = "image" | "video" | "file";

export interface ComposerAttachment {
	id: string;
	name: string;
	mime: string;
	size: number;
	kind: ComposerFileKind;
	previewUrl?: string;
	file: File;
}

export interface TurnAttachmentPayload {
	name: string;
	mime: string;
	data: string;
}

export interface AttachmentPreview {
	name: string;
	mime: string;
	kind: ComposerFileKind;
	previewUrl?: string;
}

export function attachmentKind(name: string, mime: string): ComposerFileKind {
	const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
	if (type.startsWith("image/")) return "image";
	if (type.startsWith("video/")) return "video";
	if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i.test(name)) return "image";
	if (/\.(mp4|webm|mov|m4v)$/i.test(name)) return "video";
	return "file";
}

export function fileExtension(name: string): string {
	const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
	return match?.[1]?.toUpperCase() ?? "FILE";
}

export function transferHasFiles(transfer: DataTransfer | null): boolean {
	if (!transfer) return false;
	return Array.from(transfer.types).includes("Files");
}

export function filesFromTransfer(transfer: DataTransfer | null): File[] {
	if (!transfer) return [];
	return Array.from(transfer.files ?? []);
}

export function droppedPaths(transfer: DataTransfer | null): string[] {
	if (!transfer) return [];
	const paths: string[] = [];
	for (const file of Array.from(transfer.files ?? [])) {
		const path = (file as File & { path?: string }).path?.trim();
		if (path) paths.push(path);
	}
	return paths;
}

export function createAttachment(file: File): ComposerAttachment {
	const mime = file.type || "application/octet-stream";
	const kind = attachmentKind(file.name, mime);
	const previewUrl =
		file.size > 0 &&
		kind !== "file" &&
		typeof URL !== "undefined" &&
		typeof URL.createObjectURL === "function"
			? URL.createObjectURL(file)
			: undefined;
	return {
		id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
		name: file.name || "file",
		mime,
		size: file.size,
		kind,
		...(previewUrl ? { previewUrl } : {}),
		file,
	};
}

export function releaseAttachment(item: ComposerAttachment | AttachmentPreview): void {
	if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

export function isSameFile(item: ComposerAttachment, file: File): boolean {
	return (
		item.name === file.name &&
		item.size === file.size &&
		item.file.lastModified === file.lastModified
	);
}

export function mergeAttachments(
	current: ComposerAttachment[],
	files: File[],
): { attachments: ComposerAttachment[]; rejected: string[] } {
	const attachments = [...current];
	const rejected: string[] = [];
	for (const file of files) {
		if (!file.name && file.size <= 0) continue;
		if (attachments.some((item) => isSameFile(item, file))) continue;
		if (attachments.length >= MAX_COMPOSER_FILES || file.size > MAX_COMPOSER_FILE_BYTES) {
			rejected.push(file.name || "file");
			continue;
		}
		attachments.push(createAttachment(file));
	}
	return { attachments, rejected };
}

export function toAttachmentPreviews(items: ComposerAttachment[]): AttachmentPreview[] {
	return items.map((item) => ({
		name: item.name,
		mime: item.mime,
		kind: item.kind,
		...(item.previewUrl ? { previewUrl: item.previewUrl } : {}),
	}));
}

export async function serializeComposerAttachments(
	items: ComposerAttachment[],
): Promise<TurnAttachmentPayload[]> {
	return Promise.all(
		items.map(async (item) => ({
			name: item.name,
			mime: item.mime,
			data: await blobToBase64(item.file),
		})),
	);
}
