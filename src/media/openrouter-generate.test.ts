import { describe, expect, test } from "bun:test";
import { generateImage, generateVideo, transcribeAudio } from "./openrouter-generate.ts";

describe("openrouter media generate", () => {
	test("image reads b64_json", async () => {
		const media = await generateImage({
			prompt: "a cat",
			model: "black-forest-labs/flux.2-pro",
			apiKey: "sk-test",
			fetchImpl: async () =>
				new Response(JSON.stringify({ data: [{ b64_json: "aaa" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		});
		expect(media).toEqual({
			kind: "image",
			mimeType: "image/png",
			dataUrl: "data:image/png;base64,aaa",
		});
	});

	test("image rejects an empty prompt", async () => {
		expect(
			generateImage({
				prompt: "  ",
				model: "black-forest-labs/flux.2-pro",
				apiKey: "sk-test",
				fetchImpl: async () => new Response("no"),
			}),
		).rejects.toThrow("Describe the image.");
	});

	test("video polls until the clip is ready", async () => {
		let calls = 0;
		const media = await generateVideo({
			prompt: "waves",
			model: "google/veo-3.1-lite",
			apiKey: "sk-test",
			sleep: async () => undefined,
			fetchImpl: async (input) => {
				calls += 1;
				const url = String(input);
				if (url.endsWith("/videos") && calls === 1) {
					return new Response(JSON.stringify({ id: "vid_1", status: "pending" }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (url.includes("/videos/vid_1") && !url.endsWith("/content")) {
					return new Response(JSON.stringify({ id: "vid_1", status: "completed" }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return new Response(new Uint8Array([1, 2, 3]), {
					status: 200,
					headers: { "content-type": "video/mp4" },
				});
			},
		});
		expect(media.kind).toBe("video");
		expect(media.dataUrl.startsWith("data:video/mp4;base64,")).toBe(true);
	});

	test("transcribe returns text", async () => {
		const text = await transcribeAudio({
			data: "abc",
			format: "webm",
			model: "openai/whisper-1",
			apiKey: "sk-test",
			fetchImpl: async () =>
				new Response(JSON.stringify({ text: "hello there" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		});
		expect(text).toBe("hello there");
	});
});
