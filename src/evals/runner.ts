import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type HarnessConfig, OPENROUTER_DEFAULT_BASE_URL } from "../config.ts";
import { postDeterministicScores } from "../observability/judges.ts";
import { noopObservability } from "../observability/noop.ts";
import type { Observability } from "../observability/types.ts";
import { PRODUCT_NAME } from "../product.ts";
import { type Skill, skillBodiesForNames } from "../skills/loader.ts";

export interface EvalScanResult {
	ok: boolean;
	detail?: string;
}

export interface EvalContext {
	cwd: string;
	previous: Record<string, { text: string; parsed?: unknown }>;
}

export interface EvalStep {
	id: string;
	system?: string;
	skills?: string[];
	user: string | ((ctx: EvalContext) => string | Promise<string>);
	parse?: (text: string) => unknown;
	scan?: (text: string, parsed: unknown | undefined, ctx: EvalContext) => EvalScanResult;
	artifact?: string;
}

export interface EvalSuite {
	name: string;
	steps: EvalStep[];
}

export interface EvalStepResult {
	id: string;
	ok: boolean;
	detail?: string;
	artifact?: string;
	text: string;
}

export interface EvalRunResult {
	name: string;
	ok: boolean;
	steps: EvalStepResult[];
	startedAt: string;
	finishedAt: string;
	model: string;
}

export type ChatFn = (input: { system?: string; user: string; model: string }) => Promise<string>;

export async function discoverEvalSuite(evalsDir: string, name: string): Promise<EvalSuite> {
	const dir = resolve(evalsDir, name);
	for (const file of ["eval.ts", "eval.js", "run.ts"]) {
		const path = join(dir, file);
		try {
			const mod = (await import(pathToFileURL(path).href)) as {
				default?: EvalSuite;
				suite?: EvalSuite;
			};
			const suite = mod.default ?? mod.suite;
			if (suite?.steps) return { ...suite, name: suite.name || name };
		} catch {
			// try next
		}
	}
	throw new Error(`No eval suite found at ${dir} (expected eval.ts)`);
}

export async function listEvalSuites(evalsDir: string): Promise<string[]> {
	try {
		const glob = new Bun.Glob("*/eval.ts");
		const names: string[] = [];
		for await (const rel of glob.scan({ cwd: evalsDir, onlyFiles: true })) {
			const name = rel.split("/")[0];
			if (name) names.push(name);
		}
		names.sort();
		return names;
	} catch {
		return [];
	}
}

export function createOpenRouterChat(options: { apiKey: string; baseUrl?: string }): ChatFn {
	const baseUrl = (options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
	return async ({ system, user, model }) => {
		if (!options.apiKey) throw new Error("OPENROUTER_API_KEY is not set");
		const messages: Array<{ role: string; content: string }> = [];
		if (system?.trim()) messages.push({ role: "system", content: system });
		messages.push({ role: "user", content: user });
		const res = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${options.apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://caelence.com",
				"X-Title": PRODUCT_NAME,
			},
			body: JSON.stringify({ model, messages, temperature: 0.7 }),
		});
		if (!res.ok) {
			const body = await res.text();
			throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 400)}`);
		}
		const json = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		return json.choices?.[0]?.message?.content ?? "";
	};
}

export async function runEvalSuite(input: {
	suite: EvalSuite;
	cwd: string;
	outDir?: string;
	model: string;
	skills?: Skill[];
	chat: ChatFn;
	observability?: Observability;
}): Promise<EvalRunResult> {
	const startedAt = new Date().toISOString();
	const startedMs = Date.now();
	const obs = input.observability ?? noopObservability;
	const outDir = input.outDir ?? join(input.cwd, ".harness", "evals", input.suite.name);
	mkdirSync(outDir, { recursive: true });
	const ctx: EvalContext = { cwd: input.cwd, previous: {} };
	const steps: EvalStepResult[] = [];

	await obs.startTurn(
		{
			name: "eval_run",
			metadata: { suite: input.suite.name, model: input.model, requestType: "eval" },
			tags: ["eval", input.suite.name],
		},
		async (root) => {
			for (const step of input.suite.steps) {
				const skillBlock =
					step.skills && input.skills ? skillBodiesForNames(input.skills, step.skills) : "";
				const system = [step.system, skillBlock].filter(Boolean).join("\n\n") || undefined;
				const user = typeof step.user === "function" ? await step.user(ctx) : step.user;
				const text = await obs.generation(
					step.id,
					async (gen) => {
						gen.update({ model: input.model, input: { system, user } });
						const out = await input.chat({ system, user, model: input.model });
						gen.update({ output: out });
						return out;
					},
					{ model: input.model },
				);
				let parsed: unknown;
				let ok = true;
				let detail: string | undefined;
				try {
					parsed = step.parse ? step.parse(text) : undefined;
				} catch (err) {
					ok = false;
					detail = err instanceof Error ? err.message : String(err);
				}
				if (ok && step.scan) {
					const scan = step.scan(text, parsed, ctx);
					ok = scan.ok;
					detail = scan.detail;
				}
				if (step.artifact) {
					writeFileSync(join(outDir, step.artifact), text, "utf8");
				}
				ctx.previous[step.id] = { text, parsed };
				obs.score({ name: `step_${step.id}`, value: ok ? 1 : 0 });
				steps.push({
					id: step.id,
					ok,
					detail,
					artifact: step.artifact,
					text,
				});
			}
			const resultOk = steps.every((s) => s.ok);
			root.update({
				output: { steps: steps.map((s) => ({ id: s.id, ok: s.ok })) },
				metadata: { status: resultOk ? "success" : "failed" },
			});
			postDeterministicScores(obs, {
				eval_ok: resultOk ? 1 : 0,
				generation_duration: Date.now() - startedMs,
			});
		},
	);
	await obs.flush();

	const result: EvalRunResult = {
		name: input.suite.name,
		ok: steps.every((s) => s.ok),
		steps,
		startedAt,
		finishedAt: new Date().toISOString(),
		model: input.model,
	};
	writeFileSync(join(outDir, "run-meta.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
	return result;
}

export async function runNamedEval(input: {
	config: HarnessConfig;
	cwd: string;
	name: string;
	skills?: Skill[];
	chat: ChatFn;
	observability?: Observability;
}): Promise<EvalRunResult> {
	const evalsDir = resolve(input.cwd, input.config.evalsDir);
	const suite = await discoverEvalSuite(evalsDir, input.name);
	return runEvalSuite({
		suite,
		cwd: input.cwd,
		model: input.config.model,
		skills: input.skills,
		chat: input.chat,
		observability: input.observability,
	});
}
