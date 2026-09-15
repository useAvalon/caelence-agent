import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	DEFAULT_IMAGE_MODEL,
	DEFAULT_TRANSCRIBE_MODEL,
	DEFAULT_VIDEO_MODEL,
} from "../cli/media-models.ts";
import { harnessHome } from "../desktop/secrets.ts";

export interface MediaPrefs {
	imageModel: string;
	videoModel: string;
	transcribeModel: string;
}

function prefsPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "media.json");
}

export function readMediaPrefs(env: Record<string, string | undefined> = process.env): MediaPrefs {
	const path = prefsPath(env);
	if (!existsSync(path)) {
		return {
			imageModel: DEFAULT_IMAGE_MODEL,
			videoModel: DEFAULT_VIDEO_MODEL,
			transcribeModel: DEFAULT_TRANSCRIBE_MODEL,
		};
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<MediaPrefs>;
		return {
			imageModel: parsed.imageModel?.trim() || DEFAULT_IMAGE_MODEL,
			videoModel: parsed.videoModel?.trim() || DEFAULT_VIDEO_MODEL,
			transcribeModel: parsed.transcribeModel?.trim() || DEFAULT_TRANSCRIBE_MODEL,
		};
	} catch {
		return {
			imageModel: DEFAULT_IMAGE_MODEL,
			videoModel: DEFAULT_VIDEO_MODEL,
			transcribeModel: DEFAULT_TRANSCRIBE_MODEL,
		};
	}
}

export function writeMediaPrefs(
	patch: Partial<MediaPrefs>,
	env: Record<string, string | undefined> = process.env,
): MediaPrefs {
	const next = { ...readMediaPrefs(env), ...patch };
	const path = prefsPath(env);
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, "\t")}\n`);
	return next;
}
