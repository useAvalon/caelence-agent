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

export const SPEECH_MODELS: readonly MediaModelOption[] = [
	{ id: "mistralai/voxtral-mini-tts-2603", label: "Voxtral Mini TTS", hint: "default" },
	{ id: "microsoft/mai-voice-2.1-flash", label: "MAI Voice 2.1 Flash", hint: "fast" },
	{ id: "google/gemini-3.8-flash-lite-tts", label: "Gemini Flash Lite TTS" },
	{ id: "elevenlabs/eleven-v4-turbo", label: "Eleven v4 Turbo", hint: "expressive" },
	{ id: "hexgrad/kokoro-82m", label: "Kokoro 82M", hint: "lightweight" },
];

/** OpenRouter no longer lists legacy OpenAI TTS slugs; remap saved prefs. */
export const DEPRECATED_SPEECH_MODEL_IDS = new Set([
	"openai/gpt-4o-mini-tts",
	"openai/gpt-4o-mini-tts-2025-12-15",
	"openai/tts-1",
	"openai/tts-1-hd",
]);

export const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-pro";
export const DEFAULT_VIDEO_MODEL = "google/veo-3.1-lite";
export const DEFAULT_TRANSCRIBE_MODEL = "openai/whisper-1";
export const DEFAULT_SPEECH_MODEL = "mistralai/voxtral-mini-tts-2603";
/** Lower-latency default when the native berry widget synthesizes speech. */
export const BERRY_SPEECH_MODEL = "microsoft/mai-voice-2.1-flash";

export function normalizeSpeechModelId(id: string): string {
	const trimmed = id.trim();
	if (!trimmed || DEPRECATED_SPEECH_MODEL_IDS.has(trimmed)) return DEFAULT_SPEECH_MODEL;
	return trimmed;
}

/** Provider-specific default voice for `POST /audio/speech`. */
export function defaultSpeechVoice(modelId: string): string {
	const id = modelId.toLowerCase();
	if (id.includes("voxtral")) return "en_paul_neutral";
	if (id.includes("elevenlabs")) return "george";
	if (id.includes("mai-voice")) return "en-US-AvaNeural";
	if (id.includes("gemini") && id.includes("tts")) return "Kore";
	if (id.includes("kokoro")) return "af_bella";
	return "en_paul_neutral";
}

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
	speechModel: string;
}): string {
	return [
		`Image ${mediaModelLabel(IMAGE_MODELS, prefs.imageModel)}`,
		`Clip ${mediaModelLabel(VIDEO_MODELS, prefs.videoModel)}`,
		`Listen ${mediaModelLabel(TRANSCRIBE_MODELS, prefs.transcribeModel)}`,
		`Speak ${mediaModelLabel(SPEECH_MODELS, prefs.speechModel)}`,
	].join(" · ");
}
