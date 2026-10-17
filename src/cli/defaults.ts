import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ModelRole = "router" | "navigator" | "writer" | "vision" | "utility";

export const MODEL_ROLES: readonly ModelRole[] = [
	"router",
	"navigator",
	"writer",
	"vision",
	"utility",
];

/** The only place default model IDs live. */
export const DEFAULT_MODELS: Record<ModelRole, string> = {
	router: "typesafe/jev-1.13",
	navigator: "typesafe/jev-1.13",
	writer: "~google/gemini-flash-latest",
	vision: "google/gemini-2.5-flash",
	utility: "typesafe/jev-1.13",
};

export interface RoleCaps {
	tools?: boolean;
	image?: boolean;
}

const ROLE_CAPS: Record<ModelRole, RoleCaps> = {
	router: {},
	navigator: { tools: true },
	writer: { tools: true },
	vision: { image: true },
	utility: {},
};

export function roleNeeds(role: ModelRole): RoleCaps {
	return ROLE_CAPS[role];
}

export function modelFitsRole(
	role: ModelRole,
	meta: { tools?: boolean; image?: boolean } | undefined,
): string | undefined {
	const need = ROLE_CAPS[role];
	if (need.tools && meta && meta.tools === false) return "This model cannot call tools.";
	if (need.image && meta && meta.image === false) return "This model cannot read images.";
	return undefined;
}

function prefsPath(): string {
	return join(homedir(), ".harness", "roles.json");
}

export function readRoleModels(): Partial<Record<ModelRole, string>> {
	try {
		if (!existsSync(prefsPath())) return {};
		const parsed = JSON.parse(readFileSync(prefsPath(), "utf8")) as Record<string, unknown>;
		const out: Partial<Record<ModelRole, string>> = {};
		for (const role of MODEL_ROLES) {
			const value = parsed[role];
			if (typeof value === "string" && value.trim()) out[role] = value.trim();
		}
		return out;
	} catch {
		return {};
	}
}

export function writeRoleModels(
	patch: Partial<Record<ModelRole, string>>,
): Record<ModelRole, string> {
	const next = { ...DEFAULT_MODELS, ...readRoleModels(), ...patch };
	const dir = join(homedir(), ".harness");
	mkdirSync(dir, { recursive: true });
	writeFileSync(prefsPath(), `${JSON.stringify(next, null, "\t")}\n`);
	return next;
}

export function resetRoleModels(): Record<ModelRole, string> {
	const dir = join(homedir(), ".harness");
	mkdirSync(dir, { recursive: true });
	writeFileSync(prefsPath(), `${JSON.stringify(DEFAULT_MODELS, null, "\t")}\n`);
	return { ...DEFAULT_MODELS };
}

export function modelFor(role: ModelRole): string {
	return readRoleModels()[role] ?? DEFAULT_MODELS[role];
}

export function titleForRole(role: ModelRole): string {
	return `agent:${role}`;
}

export function roleForComputerKind(kind: "direct" | "complex" | "loop" | "vision"): ModelRole {
	if (kind === "direct") return "router";
	if (kind === "complex") return "writer";
	if (kind === "vision") return "vision";
	return "navigator";
}
