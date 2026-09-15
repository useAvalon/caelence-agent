import { describe, expect, test } from "bun:test";
import { parseModalityModels } from "./openrouter-modality.ts";

describe("parseModalityModels", () => {
	test("keeps Muse, MAI, Voxtral, Qwen, and NVIDIA transcription slugs", () => {
		const items = parseModalityModels({
			data: [
				{ id: "meta/muse-voice-transcribe-1.0", name: "Meta: Muse Voice Transcribe 1.0" },
				{ id: "microsoft/mai-transcribe-2", name: "Microsoft AI: MAI-Transcribe 2" },
				{ id: "mistralai/voxtral-mini-transcribe", name: "Mistral: Voxtral Mini Transcribe" },
				{ id: "qwen/qwen3-asr-1.7b", name: "Qwen: Qwen3 ASR 1.7B" },
				{ id: "nvidia/parakeet-tdt-0.6b-v3", name: "NVIDIA: Parakeet TDT 0.6B v3" },
				{ id: "openai/whisper-1:batch", name: "Whisper batch" },
			],
		});
		expect(items.map((item) => item.id)).toEqual([
			"meta/muse-voice-transcribe-1.0",
			"microsoft/mai-transcribe-2",
			"mistralai/voxtral-mini-transcribe",
			"qwen/qwen3-asr-1.7b",
			"nvidia/parakeet-tdt-0.6b-v3",
		]);
		expect(items[0]?.label).toBe("Muse Voice Transcribe 1.0");
	});
});
