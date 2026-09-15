import { OPENROUTER_DEFAULT_BASE_URL } from "../config.ts";
import { PRODUCT_NAME } from "../product.ts";

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GeneratedMedia {
	kind: "image" | "video";
	mimeType: string;
	dataUrl: string;
}

function authHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		"HTTP-Referer": "https://caelence.com",
		"X-Title": PRODUCT_NAME,
	};
}

function asDataUrl(raw: string, fallbackMime: string): string {
	if (raw.startsWith("data:")) return raw;
	if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
	return `data:${fallbackMime};base64,${raw}`;
}

function imageUrls(json: unknown): string[] {
	if (typeof json !== "object" || json === null) return [];
	const rec = json as Record<string, unknown>;
	const found: string[] = [];
	const data = rec.data;
	if (Array.isArray(data)) {
		for (const item of data) {
			if (typeof item !== "object" || item === null) continue;
			const row = item as Record<string, unknown>;
			if (typeof row.b64_json === "string") found.push(asDataUrl(row.b64_json, "image/png"));
			else if (typeof row.url === "string") found.push(asDataUrl(row.url, "image/png"));
		}
	}
	if (found.length > 0) return found;
	const images = rec.images;
	if (Array.isArray(images)) {
		for (const item of images) {
			if (typeof item === "string") found.push(asDataUrl(item, "image/png"));
			if (typeof item !== "object" || item === null) continue;
			const row = item as Record<string, unknown>;
			const nested = row.image_url;
			if (typeof nested === "string") found.push(asDataUrl(nested, "image/png"));
			else if (typeof nested === "object" && nested !== null) {
				const url = (nested as { url?: unknown }).url;
				if (typeof url === "string") found.push(asDataUrl(url, "image/png"));
			} else if (typeof row.url === "string") found.push(asDataUrl(row.url, "image/png"));
		}
	}
	return found;
}

async function readError(res: Response): Promise<string> {
	const detail = await res.text().catch(() => "");
	const snippet = detail.replace(/\s+/g, " ").trim().slice(0, 240);
	return snippet ? `: ${snippet}` : "";
}

export async function generateImage(input: {
	prompt: string;
	model: string;
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: FetchImpl;
}): Promise<GeneratedMedia> {
	const prompt = input.prompt.trim();
	if (!prompt) throw new Error("Describe the image.");
	if (!input.apiKey.trim()) throw new Error("OpenRouter API key is missing. Add it in Settings.");
	const base = (input.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	const res = await fetchImpl(`${base}/images`, {
		method: "POST",
		headers: authHeaders(input.apiKey),
		body: JSON.stringify({ model: input.model, prompt }),
	});
	if (!res.ok) throw new Error(`Image generation failed (${res.status})${await readError(res)}`);
	const urls = imageUrls(await res.json());
	if (urls.length === 0) throw new Error("Image generation returned no image.");
	return { kind: "image", mimeType: "image/png", dataUrl: urls[0] ?? "" };
}

interface VideoJob {
	id?: string;
	status?: string;
	polling_url?: string;
	unsigned_urls?: string[];
	error?: { message?: string } | string;
}

export async function generateVideo(input: {
	prompt: string;
	model: string;
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: FetchImpl;
	sleep?: (ms: number) => Promise<void>;
}): Promise<GeneratedMedia> {
	const prompt = input.prompt.trim();
	if (!prompt) throw new Error("Describe the clip.");
	if (!input.apiKey.trim()) throw new Error("OpenRouter API key is missing. Add it in Settings.");
	const base = (input.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const res = await fetchImpl(`${base}/videos`, {
		method: "POST",
		headers: authHeaders(input.apiKey),
		body: JSON.stringify({
			model: input.model,
			prompt,
			duration: 5,
			aspect_ratio: "16:9",
		}),
	});
	if (!res.ok) throw new Error(`Video generation failed (${res.status})${await readError(res)}`);
	let job = (await res.json()) as VideoJob;
	const deadline = Date.now() + 10 * 60_000;
	while (job.status === "pending" || job.status === "in_progress" || job.status === "processing") {
		if (Date.now() > deadline) throw new Error("Video generation timed out.");
		await sleep(2_000);
		const pollUrl =
			job.polling_url || (job.id ? `${base}/videos/${encodeURIComponent(job.id)}` : "");
		if (!pollUrl) throw new Error("Video generation did not return a job id.");
		const poll = await fetchImpl(pollUrl, { headers: authHeaders(input.apiKey) });
		if (!poll.ok)
			throw new Error(`Video generation failed (${poll.status})${await readError(poll)}`);
		job = (await poll.json()) as VideoJob;
	}
	if (job.status && job.status !== "completed") {
		const message = typeof job.error === "string" ? job.error : job.error?.message || job.status;
		throw new Error(`Video generation ${message}`);
	}
	const contentUrl = job.id ? `${base}/videos/${encodeURIComponent(job.id)}/content` : "";
	for (const url of [...(job.unsigned_urls ?? []), contentUrl].filter(Boolean)) {
		const clip = await fetchImpl(url, { headers: { Authorization: `Bearer ${input.apiKey}` } });
		if (!clip.ok) continue;
		const type = clip.headers.get("content-type") || "video/mp4";
		if (type.includes("application/json")) continue;
		const buf = Buffer.from(await clip.arrayBuffer());
		if (buf.byteLength === 0) continue;
		return {
			kind: "video",
			mimeType: type.split(";")[0] || "video/mp4",
			dataUrl: `data:${type.split(";")[0] || "video/mp4"};base64,${buf.toString("base64")}`,
		};
	}
	throw new Error("Video generation finished but returned no clip.");
}

export async function transcribeAudio(input: {
	data: string;
	format: string;
	model: string;
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: FetchImpl;
}): Promise<string> {
	if (!input.apiKey.trim()) throw new Error("OpenRouter API key is missing. Add it in Settings.");
	const base = (input.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	const res = await fetchImpl(`${base}/audio/transcriptions`, {
		method: "POST",
		headers: authHeaders(input.apiKey),
		body: JSON.stringify({
			model: input.model,
			input_audio: { data: input.data, format: input.format },
		}),
	});
	if (!res.ok) throw new Error(`Transcription failed (${res.status})${await readError(res)}`);
	const json = (await res.json()) as { text?: string };
	const text = json.text?.trim() ?? "";
	if (!text) throw new Error("Transcription returned no text.");
	return text;
}
