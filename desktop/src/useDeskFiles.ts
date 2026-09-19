import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { filesFromDroppedPaths } from "./api";
import {
	type ComposerAttachment,
	droppedPaths,
	filesFromTransfer,
	mergeAttachments,
	releaseAttachment,
	transferHasFiles,
} from "./composer-files";
import type { MainView, ShowNotice } from "./desk-types";

export function useDeskFiles(input: {
	view: MainView;
	viewRef: MutableRefObject<MainView>;
	showNotice: ShowNotice;
	noticeError: (err: unknown) => void;
}) {
	const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
	const [fileDrag, setFileDrag] = useState(false);
	const attachmentsRef = useRef<ComposerAttachment[]>([]);
	const fileDragDepth = useRef(0);
	attachmentsRef.current = attachments;

	const addFiles = useCallback(
		(files: File[]) => {
			if (files.length === 0) return;
			const next = mergeAttachments(attachmentsRef.current, files);
			if (next.rejected.length > 0) {
				input.showNotice(`Could not add ${next.rejected.join(", ")}.`, "error");
			}
			if (next.attachments === attachmentsRef.current) return;
			attachmentsRef.current = next.attachments;
			setAttachments(next.attachments);
		},
		[input.showNotice],
	);

	const ingestDropped = useCallback(
		async (transfer: DataTransfer | null, extraPaths: string[] = []) => {
			if (input.viewRef.current !== "chat") return;
			const html = filesFromTransfer(transfer);
			const usable = html.filter((file) => file.size > 0);
			if (usable.length > 0) {
				addFiles(usable);
				return;
			}
			const paths = [...new Set([...extraPaths, ...droppedPaths(transfer)])];
			if (paths.length === 0) {
				if (html.length > 0) addFiles(html);
				return;
			}
			try {
				const files = await filesFromDroppedPaths(paths);
				addFiles(files.length > 0 ? files : html);
			} catch (err) {
				input.noticeError(err);
			}
		},
		[addFiles, input.noticeError, input.viewRef],
	);

	const takeAttachments = useCallback((): ComposerAttachment[] => {
		const items = attachmentsRef.current;
		attachmentsRef.current = [];
		setAttachments([]);
		return items;
	}, []);

	const removeAttachment = useCallback((index: number) => {
		setAttachments((current) => {
			const item = current[index];
			if (item) releaseAttachment(item);
			return current.filter((_, at) => at !== index);
		});
	}, []);

	const onFileDragEnter = useCallback(
		(event: React.DragEvent) => {
			if (input.view !== "chat" || !transferHasFiles(event.dataTransfer)) return;
			event.preventDefault();
			fileDragDepth.current += 1;
			setFileDrag(true);
		},
		[input.view],
	);

	const onFileDragOver = useCallback((event: React.DragEvent) => {
		if (!transferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);

	const onFileDragLeave = useCallback((event: React.DragEvent) => {
		if (!transferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
		if (fileDragDepth.current === 0) setFileDrag(false);
	}, []);

	const onFileDrop = useCallback(
		(event: React.DragEvent) => {
			if (input.view !== "chat" || !transferHasFiles(event.dataTransfer)) return;
			event.preventDefault();
			event.stopPropagation();
			fileDragDepth.current = 0;
			setFileDrag(false);
			void ingestDropped(event.dataTransfer);
		},
		[ingestDropped, input.view],
	);

	useEffect(() => {
		const onOver = (event: DragEvent) => {
			if (!transferHasFiles(event.dataTransfer)) return;
			event.preventDefault();
		};
		const onDrop = (event: DragEvent) => {
			if (!transferHasFiles(event.dataTransfer)) return;
			event.preventDefault();
			fileDragDepth.current = 0;
			setFileDrag(false);
			void ingestDropped(event.dataTransfer);
		};
		window.addEventListener("dragover", onOver);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragover", onOver);
			window.removeEventListener("drop", onDrop);
			for (const item of attachmentsRef.current) releaseAttachment(item);
		};
	}, [ingestDropped]);

	useEffect(() => {
		let cancelled = false;
		let stop: (() => void) | undefined;
		void (async () => {
			try {
				const { getCurrentWebview } = await import("@tauri-apps/api/webview");
				const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
					if (input.viewRef.current !== "chat") return;
					if (event.payload.type === "enter" || event.payload.type === "over") {
						setFileDrag(true);
						return;
					}
					if (event.payload.type === "leave") {
						setFileDrag(false);
						return;
					}
					if (event.payload.type === "drop") {
						setFileDrag(false);
						void ingestDropped(null, event.payload.paths);
					}
				});
				if (cancelled) unlisten();
				else stop = unlisten;
			} catch {
				// Browser preview has no Tauri webview.
			}
		})();
		return () => {
			cancelled = true;
			stop?.();
		};
	}, [ingestDropped, input.viewRef]);

	return {
		attachments,
		attachmentsRef,
		fileDrag,
		addFiles,
		ingestDropped,
		takeAttachments,
		removeAttachment,
		onFileDragEnter,
		onFileDragOver,
		onFileDragLeave,
		onFileDrop,
	};
}
