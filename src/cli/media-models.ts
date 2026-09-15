export interface MediaModelOption {
	id: string;
	label: string;
	hint?: string;
}

/** Offline seed. The picker prefers the live OpenRouter catalog. */
export const IMAGE_MODELS: readonly MediaModelOption[] = [
	{ id: "black-forest-labs/flux.2-pro", label: "Flux 2 Pro" },
	{ id: "black-forest-labs/flux.2-flex", label: "Flux 2 Flex" },
	{ id: "google/gemini-2.5-flash-image", label: "Gemini Flash Image" },
	{ id: "bytedance/seedream-4.5", label: "Seedream 4.5" },
	{ id: "openai/gpt-5-image", label: "GPT image" },
	{ id: "meta/muse-image", label: "Muse Image" },
	{ id: "microsoft/mai-image-2.6", label: "MAI Image" },
];

export const VIDEO_MODELS: readonly MediaModelOption[] = [
	{ id: "google/veo-3.1-lite", label: "Veo 3.1 Lite" },
	{ id: "google/veo-3.1", label: "Veo 3.1" },
	{ id: "bytedance/seedance-2.0-mini", label: "Seedance 2 Mini" },
];

export const TRANSCRIBE_MODELS: readonly MediaModelOption[] = [
	{ id: "openai/whisper-1", label: "Whisper" },
	{ id: "openai/whisper-large-v3", label: "Whisper Large V3" },
	{ id: "openai/whisper-large-v3-turbo", label: "Whisper Large V3 Turbo" },
	{ id: "openai/gpt-4o-mini-transcribe", label: "GPT-4o mini transcribe" },
	{ id: "openai/gpt-4o-transcribe", label: "GPT-4o transcribe" },
	{ id: "openai/gpt-transcribe", label: "GPT Transcribe" },
	{ id: "meta/muse-voice-transcribe-1.0", label: "Muse Voice Transcribe" },
	{ id: "microsoft/mai-transcribe-2", label: "MAI Transcribe 2" },
	{ id: "microsoft/mai-transcribe-1.5", label: "MAI Transcribe 1.5" },
	{ id: "mistralai/voxtral-mini-transcribe", label: "Voxtral Mini Transcribe" },
	{ id: "mistralai/voxtral-mini-3b-2507", label: "Voxtral Mini" },
	{ id: "mistralai/voxtral-small-24b-2507-stt", label: "Voxtral Small STT" },
	{ id: "qwen/qwen3-asr-1.7b", label: "Qwen3 ASR 1.7B" },
	{ id: "qwen/qwen3-asr-0.6b", label: "Qwen3 ASR 0.6B" },
	{ id: "qwen/qwen3-asr-flash-2026-02-10", label: "Qwen3 ASR Flash" },
	{ id: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b", label: "Nemotron ASR" },
	{ id: "nvidia/parakeet-tdt-0.6b-v3", label: "Parakeet TDT" },
	{ id: "google/chirp-3", label: "Chirp 3" },
	{ id: "x-ai/grok-stt-1.0", label: "Grok STT" },
	{ id: "deepgram/nova-3", label: "Deepgram Nova 3" },
	{ id: "fish-audio/transcribe-1", label: "Fish Transcribe" },
];

export const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-pro";
export const DEFAULT_VIDEO_MODEL = "google/veo-3.1-lite";
export const DEFAULT_TRANSCRIBE_MODEL = "openai/whisper-1";

export function mediaPickerItems(
	list: readonly MediaModelOption[],
	current?: string,
): Array<{ id: string; label: string; hint?: string }> {
	const items = list.map((model) => ({
		id: model.id,
		label: model.label,
		...(model.hint ? { hint: model.hint } : {}),
	}));
	const id = current?.trim();
	if (id && !items.some((item) => item.id === id)) {
		items.unshift({ id, label: id, hint: "current" });
	}
	return items;
}

export function mediaModelLabel(list: readonly MediaModelOption[], id: string): string {
	return list.find((model) => model.id === id)?.label ?? id;
}

export function formatMediaComposerLine(prefs: {
	imageModel: string;
	videoModel: string;
	transcribeModel: string;
}): string {
	return [
		`Image ${mediaModelLabel(IMAGE_MODELS, prefs.imageModel)}`,
		`Clip ${mediaModelLabel(VIDEO_MODELS, prefs.videoModel)}`,
		`Speech ${mediaModelLabel(TRANSCRIBE_MODELS, prefs.transcribeModel)}`,
	].join(" · ");
}
