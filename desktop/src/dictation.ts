export function audioFormatFromMime(mime: string): string {
	const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
	if (type.includes("wav")) return "wav";
	if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
	if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "mp4";
	if (type.includes("ogg")) return "ogg";
	return "webm";
}

export function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = String(reader.result ?? "");
			const comma = dataUrl.indexOf(",");
			if (comma < 0) {
				reject(new Error("Recording was empty."));
				return;
			}
			resolve(dataUrl.slice(comma + 1));
		};
		reader.onerror = () => reject(reader.error ?? new Error("Could not read the recording."));
		reader.readAsDataURL(blob);
	});
}

export function canUseWebMic(): boolean {
	return (
		typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
	);
}

export function isMicPermissionDenied(err: unknown): boolean {
	const name =
		err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
	return name === "NotAllowedError" || name === "PermissionDeniedError";
}

export function dictationErrorMessage(err: unknown): string {
	const name =
		err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
	if (isMicPermissionDenied(err)) {
		return "Microphone is blocked. Allow it for Caelence agent, then try again.";
	}
	if (name === "NotFoundError") {
		return "No microphone is available.";
	}
	return err instanceof Error ? err.message : "Could not start the microphone.";
}

export function pickRecorderMime(): string | undefined {
	if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
		return undefined;
	}
	for (const type of ["audio/webm", "audio/mp4", "audio/ogg"]) {
		if (MediaRecorder.isTypeSupported(type)) return type;
	}
	return undefined;
}
