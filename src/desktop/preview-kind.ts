export type FilePreviewKind = "markdown" | "html" | "image" | "text";

const IMAGE_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
};

export function fileExt(path: string): string {
	const base = path.replaceAll("\\", "/").split("/").pop() ?? path;
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return "";
	return base.slice(dot + 1).toLowerCase();
}

export function filePreviewKind(path: string): FilePreviewKind {
	const ext = fileExt(path);
	if (ext === "md" || ext === "markdown") return "markdown";
	if (ext === "html" || ext === "htm") return "html";
	if (ext in IMAGE_MIME) return "image";
	return "text";
}

export function filePreviewMime(path: string): string | undefined {
	return IMAGE_MIME[fileExt(path)];
}
