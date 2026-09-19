import { type MutableRefObject, type SetStateAction, useCallback, useRef, useState } from "react";
import { type BridgeClient, micStart, micStop, transcribe } from "./api";
import type { ShowNotice, UiStatus } from "./desk-types";
import {
	audioFormatFromMime,
	blobToBase64,
	canUseWebMic,
	dictationErrorMessage,
	isMicPermissionDenied,
	pickRecorderMime,
} from "./dictation";

export function useDeskDictation(input: {
	bridge: BridgeClient | null;
	status: UiStatus;
	showNotice: ShowNotice;
	noticeError: (err: unknown) => void;
	setDraft: (value: SetStateAction<string>) => void;
	inputRef: MutableRefObject<HTMLTextAreaElement | null>;
}) {
	const [listening, setListening] = useState(false);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const dictationModeRef = useRef<"web" | "native" | null>(null);

	const applySpoken = useCallback(
		async (data: string, format: string) => {
			if (!input.bridge) return;
			try {
				const result = await transcribe(input.bridge, { data, format });
				const spoken = result.text.trim();
				if (!spoken) {
					input.showNotice("Transcription returned no text.", "error");
					return;
				}
				input.setDraft((current) => (current.trim() ? `${current.trim()} ${spoken}` : spoken));
				input.inputRef.current?.focus();
			} catch (err) {
				input.noticeError(err);
			}
		},
		[input.bridge, input.inputRef, input.noticeError, input.setDraft, input.showNotice],
	);

	const stopDictation = useCallback(() => {
		const mode = dictationModeRef.current;
		if (mode === "native") {
			dictationModeRef.current = null;
			setListening(false);
			void (async () => {
				try {
					const clip = await micStop();
					await applySpoken(clip.data, clip.format);
				} catch (err) {
					input.noticeError(err);
				}
			})();
			return;
		}
		const recorder = recorderRef.current;
		if (!recorder) {
			setListening(false);
			return;
		}
		if (recorder.state !== "inactive") recorder.stop();
	}, [applySpoken, input.noticeError]);

	const startDictation = useCallback(async () => {
		if (!input.bridge || input.status !== "idle" || listening) return;
		const startWeb = async () => {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mime = pickRecorderMime();
			const recorder = mime
				? new MediaRecorder(stream, { mimeType: mime })
				: new MediaRecorder(stream);
			const chunks: Blob[] = [];
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) chunks.push(event.data);
			};
			recorder.onstop = () => {
				for (const track of stream.getTracks()) track.stop();
				recorderRef.current = null;
				dictationModeRef.current = null;
				setListening(false);
				const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
				if (blob.size === 0) return;
				void blobToBase64(blob).then((data) => applySpoken(data, audioFormatFromMime(blob.type)));
			};
			recorderRef.current = recorder;
			dictationModeRef.current = "web";
			recorder.start(250);
			setListening(true);
		};
		if (canUseWebMic()) {
			try {
				await startWeb();
				return;
			} catch (err) {
				if (isMicPermissionDenied(err)) {
					input.showNotice(dictationErrorMessage(err), "error");
					return;
				}
			}
		}
		try {
			await micStart();
			dictationModeRef.current = "native";
			setListening(true);
		} catch (err) {
			input.showNotice(dictationErrorMessage(err), "error");
		}
	}, [applySpoken, input.bridge, input.showNotice, input.status, listening]);

	const stopRecorder = useCallback(() => {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== "inactive") recorder.stop();
		if (dictationModeRef.current === "native") {
			void micStop().catch(() => undefined);
			dictationModeRef.current = null;
		}
	}, []);

	return { listening, applySpoken, startDictation, stopDictation, stopRecorder };
}
