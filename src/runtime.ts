import { resolve } from "node:path";
import { resolveTheme, type Theme } from "./cli/theme.ts";
import { type HarnessConfig, loadConfig, resolveOpenRouter } from "./config.ts";
import {
	type ApprovalGate,
	type ApprovalRequest,
	createExecApprovalGate,
	type ExecApprovalPolicy,
} from "./core/approval.ts";
import type { AgentEventEmitter, MainModelProvider } from "./core/events.ts";
import { createHookRunner } from "./core/hooks.ts";
import { loadInstructionLayers } from "./core/instructions.ts";
import type { McpToolDefinition } from "./core/mcp.ts";
import {
	type AgentMode,
	filterToolsForMode,
	parseAgentMode,
	toolsAllowedInMode,
} from "./core/mode.ts";
import {
	buildSystemPrompt,
	defaultSummarizer,
	type RunTurnDeps,
	runTurn,
} from "./core/run-turn.ts";
import {
	createFileSessionStore,
	createMemorySessionStore,
	type Session,
	type SessionStore,
} from "./core/session.ts";
import { loadStdioMcpTools } from "./core/stdio-mcp.ts";
import {
	type ConstructAgent,
	constructOpenRouterProvider,
	createConstructAgent,
} from "./core/strands.ts";
import { addUsage, type TokenUsage } from "./core/usage.ts";
import { type ChatFn, createOpenRouterChat } from "./evals/runner.ts";
import { buildRemoteMcpTools } from "./integrations/remote-mcp.ts";
import { linkedMcpSources } from "./integrations/store.ts";
import { createObservability } from "./observability/create.ts";
import { noopObservability } from "./observability/noop.ts";
import { harnessPromptRecords, syncPrompts } from "./observability/prompts.ts";
import type { Observability } from "./observability/types.ts";
import { resolveAgentVersion } from "./observability/version.ts";
import { authorSkillMarkdown } from "./skills/author-skill.ts";
import { createHostSkill, parseSkillNewArgs } from "./skills/create-skill.ts";
import {
	disableSkills,
	enableSkills,
	isSkillDisabled,
	readDisabledSkillNames,
} from "./skills/disabled.ts";
import {
	isBundledCatalogDir,
	loadMergedSkills,
	resolveHostSkillDirs,
	type Skill,
	skillCatalogPrompt,
} from "./skills/loader.ts";
import { installSkillFromSource, removeSkillFromRoots, searchSkills } from "./skills/registry.ts";
import { userSkillsDir } from "./skills/user-dir.ts";
import { createGitTools } from "./tools/git.ts";
import { createLocalTools } from "./tools/local.ts";
import { createReadSkillTool } from "./tools/read-skill.ts";
import { createTaskTool } from "./tools/subagent.ts";
import { createMemoryTodoStore, createTodoTool } from "./tools/todo.ts";

export interface HarnessRuntime {
	cwd: string;
	config: HarnessConfig;
	theme: Theme;
	skills: Skill[];
	store: SessionStore;
	systemPrompt: string;
	modelId: string;
	mode: AgentMode;
	activeSessionId?: string;
	spend?: TokenUsage;
	hasApiKey: boolean;
	setApiKey(key: string): void;
	runTurn(
		message: string,
		emit: AgentEventEmitter,
		options?: {
			signal?: AbortSignal;
			approvalAsk?: (req: ApprovalRequest) => Promise<boolean>;
			editUserTurn?: number;
		},
	): Promise<Session | undefined>;
	setModel(modelId: string): void;
	setMode(mode: AgentMode): void;
	setSession(id: string | undefined): void;
	allowExecAlways(): void;
	allowRiskyAlways(toolName: string): void;
	compact(): Promise<boolean>;
	reloadSkills(): Skill[];
	reloadIntegrations(): Promise<void>;
	integrationIds(): string[];
	authorSkill(name: string, brief: string): Promise<{ rel: string } | { error: string }>;
	findSkills(query: string): Promise<string>;
	disabledSkills(): string[];
	enableSkill(name: string): { ok: boolean };
	addSkill(
		source: string,
		options?: { skill?: string; scope?: "user" | "project" },
	): Promise<{ rel: string } | { error: string }>;
	removeSkill(name: string): { ok: boolean; error?: string };
	chat: ChatFn;
	observability: Observability;
	close(): void;
}

export interface CreateHarnessOptions {
	cwd: string;
	config?: HarnessConfig;
	constructAgent?: ConstructAgent;
	provider?: MainModelProvider;
	approvalPolicy?: ExecApprovalPolicy;
	extraTools?: McpToolDefinition[];
	observability?: Observability;
	mode?: AgentMode;
	/** Load one-click MCP connections from ~/.harness. Default on unless a test provider is passed. */
	loadIntegrations?: boolean;
}

const SUBAGENT_INSTRUCTIONS = [
	"You are a subagent. Complete the assigned task and reply with the result.",
	"Do not ask the user questions. Do not spawn further subagents.",
].join(" ");

export async function createHarness(options: CreateHarnessOptions): Promise<HarnessRuntime> {
	const cwd = options.cwd;
	const config = options.config ?? (await loadConfig(cwd));
	const theme = resolveTheme(config.theme);
	const skillsDir = resolve(cwd, config.skillsDir);
	const userDir = userSkillsDir();
	const hostSkillDirs = () => resolveHostSkillDirs(cwd, config.skillsDir);
	const removableRoots = () => {
		const roots = [userDir];
		if (!isBundledCatalogDir(skillsDir)) roots.push(skillsDir);
		return roots;
	};
	const loadActiveSkills = (): Skill[] => {
		const disabled = readDisabledSkillNames(cwd);
		return loadMergedSkills(hostSkillDirs(), userDir).filter(
			(skill) => !disabled.has(skill.name.toLowerCase()),
		);
	};
	let skills = loadActiveSkills();
	const layers = loadInstructionLayers({ cwd, projectFile: config.instructionsFile });
	let mode = parseAgentMode(options.mode ?? config.mode);
	const composePrompt = (nextMode: AgentMode) =>
		buildSystemPrompt({
			name: config.name,
			cwd,
			userInstructions: layers.user,
			projectInstructions: layers.project,
			skillCatalog: skillCatalogPrompt(skills),
			mode: nextMode,
		});
	let systemPrompt = composePrompt(mode);
	const store = createFileSessionStore(cwd);
	const local = createLocalTools({ cwd });
	const todos = createMemoryTodoStore();
	const hooks = createHookRunner({ cwd, hooks: config.hooks });
	void hooks.sessionStart();
	const closers: Array<() => void> = [];
	const extra: McpToolDefinition[] = [...(options.extraTools ?? [])];
	let integrationTools: McpToolDefinition[] = [];
	const shouldLoadIntegrations = options.loadIntegrations ?? !options.provider;
	const reloadIntegrations = async (): Promise<void> => {
		if (!shouldLoadIntegrations) {
			integrationTools = [];
			return;
		}
		integrationTools = await buildRemoteMcpTools({ sources: linkedMcpSources() });
	};
	await reloadIntegrations();
	for (const mcp of config.mcp) {
		try {
			const loaded = await loadStdioMcpTools({ ...mcp, cwd });
			extra.push(...loaded.tools);
			closers.push(loaded.close);
		} catch {
			// fail-soft: missing extra MCP must not block the REPL
		}
	}

	const or = resolveOpenRouter(config);
	let apiKey = or.apiKey;
	let modelId = or.model;
	let activeSessionId: string | undefined;
	const observability =
		options.observability ??
		(config.observability?.enabled === false
			? noopObservability
			: await createObservability({ enabled: config.observability?.enabled }));
	if (!options.observability) void syncPrompts({ prompts: harnessPromptRecords() });
	const agentVersion = resolveAgentVersion();
	const makeProvider = (id: string): MainModelProvider =>
		options.provider ??
		constructOpenRouterProvider({
			apiKey,
			model: id,
			baseUrl: or.baseUrl,
			sessionId: () => activeSessionId,
		});
	let provider = makeProvider(modelId);
	const constructAgent = options.constructAgent ?? createConstructAgent();
	const alwaysAllow = new Set<string>();
	let activeEmit: AgentEventEmitter = () => undefined;
	let activeApproval: ApprovalGate | undefined;
	const subagentsEnabled = config.subagents?.enabled !== false;

	const baseTools = (): McpToolDefinition[] =>
		filterToolsForMode(mode, [
			...local.listTools(),
			...createGitTools(cwd),
			createTodoTool(todos),
			...extra,
			...integrationTools,
			createReadSkillTool(skills),
		]);

	const nestedSystem = (extraSystem: string): string =>
		[
			buildSystemPrompt({
				name: `${config.name} subagent`,
				cwd,
				projectInstructions: SUBAGENT_INSTRUCTIONS,
				skillCatalog: skillCatalogPrompt(skills),
				mode,
			}),
			extraSystem.trim(),
		]
			.filter(Boolean)
			.join("\n\n");

	const runtime: HarnessRuntime = {
		cwd,
		config,
		theme,
		get skills() {
			return skills;
		},
		store,
		get systemPrompt() {
			return systemPrompt;
		},
		get modelId() {
			return modelId;
		},
		get mode() {
			return mode;
		},
		spend: undefined,
		get activeSessionId() {
			return activeSessionId;
		},
		set activeSessionId(id: string | undefined) {
			activeSessionId = id;
		},
		get hasApiKey() {
			return Boolean(apiKey);
		},
		setApiKey(key) {
			apiKey = key.trim();
			if (apiKey) process.env.OPENROUTER_API_KEY = apiKey;
			else delete process.env.OPENROUTER_API_KEY;
			if (!options.provider) provider = makeProvider(modelId);
			runtime.chat = createOpenRouterChat({ apiKey, baseUrl: or.baseUrl });
		},
		setModel(id) {
			modelId = id;
			if (!options.provider) provider = makeProvider(id);
		},
		setMode(next) {
			mode = parseAgentMode(next);
			systemPrompt = composePrompt(mode);
		},
		setSession(id) {
			activeSessionId = id;
		},
		allowExecAlways() {
			alwaysAllow.add("exec");
		},
		allowRiskyAlways(toolName) {
			alwaysAllow.add(toolName);
		},
		async compact() {
			if (!runtime.activeSessionId) return false;
			const session = await store.get(runtime.activeSessionId);
			if (!session) return false;
			const next = await store.maybeCompact(session, 1, defaultSummarizer(provider));
			return next.messages.length > session.messages.length;
		},
		reloadSkills() {
			skills = loadActiveSkills();
			systemPrompt = composePrompt(mode);
			return skills;
		},
		async reloadIntegrations() {
			await reloadIntegrations();
		},
		integrationIds() {
			return linkedMcpSources().map((source) => source.connectorId);
		},
		async authorSkill(name, brief) {
			const parsed = parseSkillNewArgs(`new ${name} ${brief}`);
			if ("error" in parsed) return { error: parsed.error };
			const authored = await authorSkillMarkdown({
				name: parsed.name,
				brief: parsed.brief,
				chat: runtime.chat,
				model: modelId,
			});
			if ("error" in authored) return authored;
			const written = createHostSkill({
				skillsDir,
				name: parsed.name,
				markdown: authored.markdown,
			});
			if (!written.created) return { error: written.reason ?? "Could not write skill." };
			runtime.reloadSkills();
			return { rel: `${config.skillsDir}/${written.rel}` };
		},
		async findSkills(query) {
			return searchSkills(query);
		},
		disabledSkills() {
			return [...readDisabledSkillNames(cwd)];
		},
		enableSkill(name) {
			enableSkills(cwd, name);
			runtime.reloadSkills();
			return { ok: true };
		},
		async addSkill(source, options) {
			const name = source.split("@").pop()?.trim() ?? source;
			if (isSkillDisabled(cwd, name)) {
				runtime.enableSkill(name);
				return { rel: name };
			}
			const destRoot =
				options?.scope === "project" && !isBundledCatalogDir(skillsDir) ? skillsDir : userDir;
			const result = await installSkillFromSource({
				source,
				destRoot,
				...(options?.skill ? { skill: options.skill } : {}),
			});
			if ("error" in result) {
				const extra = result.choices?.length ? ` Available: ${result.choices.join(", ")}` : "";
				return { error: `${result.error}${extra}` };
			}
			runtime.reloadSkills();
			if (result.installed && result.installed.length > 1) {
				return { rel: result.installed.join(", ") };
			}
			const root =
				options?.scope === "project" && !isBundledCatalogDir(skillsDir)
					? config.skillsDir
					: userDir;
			return { rel: `${root}/${result.rel}` };
		},
		removeSkill(name) {
			const loaded = skills.find((skill) => skill.name.toLowerCase() === name.trim().toLowerCase());
			if (loaded && loaded.source !== "user") {
				disableSkills(cwd, loaded.name);
				runtime.reloadSkills();
				return { ok: true };
			}
			const result = removeSkillFromRoots(name, removableRoots());
			if (!result.removed) return { ok: false, error: result.reason };
			runtime.reloadSkills();
			return { ok: true };
		},
		chat: createOpenRouterChat({ apiKey, baseUrl: or.baseUrl }),
		observability,
		async runTurn(message, emit, turnOptions) {
			if (!options.provider && !apiKey) {
				emit({ kind: "error", message: "OPENROUTER_API_KEY is not set." });
				return undefined;
			}
			const policy = options.approvalPolicy ?? config.tools.exec.approval;
			const approval: ApprovalGate = createExecApprovalGate({
				policy,
				alwaysAllow,
				emit,
				ask: async (req) => {
					if (turnOptions?.approvalAsk) return turnOptions.approvalAsk(req);
					if (policy === "prompt") return false;
					return true;
				},
			});
			activeEmit = emit;
			activeApproval = approval;
			const tools = baseTools();
			if (subagentsEnabled && toolsAllowedInMode(mode, "task")) {
				tools.push(
					createTaskTool({
						skills,
						parentEmit: () => activeEmit,
						async run({ prompt, extraSystem, emit: nestedEmit }) {
							const nestedDeps: RunTurnDeps = {
								cwd,
								name: `${config.name} subagent`,
								systemPrompt: nestedSystem(extraSystem),
								tools: baseTools(),
								approval: activeApproval ?? approval,
								store: createMemorySessionStore(),
								provider,
								constructAgent,
								resolveProvider: options.provider ? undefined : (id) => makeProvider(id),
								observability,
								traceName: "subagent",
								requestType: "chat",
								agentVersion,
								hooks,
								mode,
							};
							await runTurn(nestedDeps, { message: prompt, model: modelId }, nestedEmit, {
								signal: turnOptions?.signal,
							});
						},
					}),
				);
			}
			const deps: RunTurnDeps = {
				cwd,
				name: config.name,
				systemPrompt,
				tools,
				approval,
				store,
				provider,
				constructAgent,
				resolveProvider: options.provider ? undefined : (id) => makeProvider(id),
				summarize: defaultSummarizer(provider),
				observability,
				traceName: "agent_turn",
				requestType: "chat",
				agentVersion,
				hooks,
				mode,
			};
			const capture: AgentEventEmitter = (event) => {
				if (event.kind === "usage") {
					runtime.spend = addUsage(runtime.spend, {
						promptTokens: event.promptTokens,
						completionTokens: event.completionTokens,
						totalTokens: event.totalTokens,
						...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
					});
				}
				emit(event);
			};
			const session = await runTurn(
				deps,
				{
					message,
					sessionId: runtime.activeSessionId,
					model: modelId,
					...(turnOptions?.editUserTurn !== undefined
						? { editUserTurn: turnOptions.editUserTurn }
						: {}),
				},
				capture,
				{ signal: turnOptions?.signal },
			);
			if (session) runtime.activeSessionId = session.id;
			return session;
		},
		close() {
			for (const close of closers) close();
			void observability.flush();
		},
	};
	return runtime;
}
