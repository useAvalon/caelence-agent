import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RoutineStep {
	kind: string;
	role?: string;
	name?: string;
	urlPattern?: string;
	text?: string;
	label: string;
	risky?: boolean;
}

export interface SavedRoutine {
	name: string;
	description: string;
	variables: string[];
	steps: RoutineStep[];
}

export function routinesDir(): string {
	return join(homedir(), ".agent", "routines");
}

export function listRoutines(dir = routinesDir()): SavedRoutine[] {
	try {
		return readdirSync(dir)
			.filter((name) => name.endsWith(".json"))
			.map((name) => {
				const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as SavedRoutine;
				return raw;
			})
			.filter((item) => typeof item.name === "string");
	} catch {
		return [];
	}
}

export function saveRoutine(routine: SavedRoutine, dir = routinesDir()): void {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${routine.name.replace(/[^\w.-]+/g, "-").toLowerCase()}.json`);
	writeFileSync(file, `${JSON.stringify(routine, null, 2)}\n`);
}

export function applyRoutineVars(text: string, vars: Record<string, string>): string {
	return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function generalizeTypedValues(steps: RoutineStep[]): {
	steps: RoutineStep[];
	variables: string[];
} {
	const variables: string[] = [];
	const next = steps.map((step, index) => {
		if (!step.text || step.text.length < 8) return step;
		const name = index === 0 ? "topic" : `value${index}`;
		variables.push(name);
		return { ...step, text: `{{${name}}}` };
	});
	return { steps: next, variables };
}
