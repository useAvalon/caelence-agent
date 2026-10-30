import { resolve } from "node:path";
import {
	type BrowserSession,
	browserAccess,
	browserFailurePrompt,
	browserPrompt,
	browserSetupHint,
	mentionsBrowser,
	startBrowserTools,
} from "./browser/browser-use.ts";
import { resolveTheme, type Theme } from "./cli/theme.ts";
import { type HarnessConfig, loadConfig, resolveOpenRouter } from "./config.ts";
import {
	type ApprovalGate,
	type ApprovalRequest,
	createExecApprovalGate,
	type ExecApprovalPolicy,
	isFileWriteTool,
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
	type TurnInterceptor,
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
import { classifyToolApproval } from "./decisions/approval.ts";
import type { FetchImpl } from "./decisions/client.ts";
import { type ResolvedDecisions, resolveDecisions } from "./decisions/config.ts";
import { turnHasDurableFact } from "./decisions/memory.ts";
import type { ShortcutPlanner } from "./decisions/shortcuts.ts";
import { listUploadOriginals, matchUploadEdit } from "./desktop/uploads.ts";
import { type ChatFn, createOpenRouterChat } from "./evals/runner.ts";
import { buildRemoteMcpTools } from "./integrations/remote-mcp.ts";
import { linkedMcpSources } from "./integrations/store.ts";
import { listUserMcpServers, userMcpToolPrefix } from "./mcp/user-servers.ts";
import { extractMemories, turnMemorySource } from "./memory/extract.ts";
import { isMemoryEnabled } from "./memory/prefs.ts";
import { formatRetrievedMemory } from "./memory/prompt.ts";
import { searchFacts } from "./memory/store.ts";
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
import {
	findSkillForCatalogId,
	installSkillFromSource,
	isBundledCatalogId,
	removeSkillFromRoots,
	searchSkills,
	skillNameFromCatalogId,
} from "./skills/registry.ts";
import { userSkillsDir } from "./skills/user-dir.ts";
import { createGitTools } from "./tools/git.ts";
import { createLocalTools } from "./tools/local.ts";
import { createReadSkillTool } from "./tools/read-skill.ts";
import { createTaskTool } from "./tools/subagent.ts";
import { createMemoryTodoStore, createTodoTool } from "./tools/todo.ts";

/** Per-turn options a host can pass to `runTurn`. */
export interface HarnessTurnOptions {
	signal?: AbortSignal;
	approvalAsk?: (req: ApprovalRequest) => Promise<boolean>;
	editUserTurn?: number;
	/**
	 * What the chat shows and stores, and what decisions and `@browser` read, when it differs from
	 * the `message` the model sees. Lets a host prefix instructions without them reaching the chat.
	 */
	displayMessage?: string;
	/** Appended to the system prompt for this turn only. */
	systemAppend?: string;
	/** Tool names hidden from the model for this turn only. */
	excludeTools?: readonly string[];
	/**
	 * Data for this turn that the harness passes back to the host's `intercept` hook untouched, for
	 * example flags the host's UI sent with the request.
	 */
	hostData?: Record<string, unknown>;
	/**
	 * Ask the user only about requests this returns true for. Every other tool call runs without a
	 * prompt. The `deny` policy and the host denylist still apply to the calls it lets through.
	 */
	promptOnly?: (req: ApprovalRequest) => boolean;
}

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
		options?: HarnessTurnOptions,
	): Promise<Session | undefined>;
	setModel(modelId: string): void;
	setMode(mode: AgentMode): void;
	setSession(id: string | undefined): void;
	allowExecAlways(): void;
	allowRiskyAlways(toolName: string): void;
	compact(): Promise<boolean>;
	reloadSkills(): Skill[];
	reloadIntegrations(): Promise<void>;
	reloadExtraMcp(): Promise<void>;
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
	/** Replaces the stdio MCP loader for the browser server. Tests only. */
	browserLoader?: typeof loadStdioMcpTools;
	/**
	 * Decision-model calls (approval assist, memory gate, shortcuts). On when an OpenRouter key
	 * is set, off for an injected test `provider` unless this is true.
	 */
	decisions?: boolean;
	/** Host judgment of which messages are one direct tool call. See ShortcutPlanner. */
	shortcut?: ShortcutPlanner;
	/** Host handler that can answer a whole turn without the chat model. See TurnInterceptor. */
	intercept?: TurnInterceptor;
	/** Appended to the system prompt on every turn, for example a host persona. */
	systemAppend?: string;
	/** Replaces fetch for decision calls. Tests only. */
	decisionsFetch?: FetchImpl;
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
	const hostAppend = options.systemAppend?.trim();
	const composePrompt = (nextMode: AgentMode) => {
		const base = buildSystemPrompt({
			name: config.name,
			cwd,
			userInstructions: layers.user,
			projectInstructions: layers.project,
			skillCatalog: skillCatalogPrompt(skills),
			mode: nextMode,
		});
		return hostAppend ? `${base}\n\n${hostAppend}` : base;
	};
	let systemPrompt = composePrompt(mode);
	const store = createFileSessionStore(cwd);
	const local = createLocalTools({
		cwd,
		extraWriteAbsolutes: () => listUploadOriginals(cwd),
	});
	const todos = createMemoryTodoStore();
	const hooks = createHookRunner({ cwd, hooks: config.hooks });
	void hooks.sessionStart();
	const extra: McpToolDefinition[] = [...(options.extraTools ?? [])];
	let extraMcpTools: McpToolDefinition[] = [];
	let extraMcpClosers: Array<() => void> = [];
	let integrationTools: McpToolDefinition[] = [];
	const shouldLoadIntegrations = options.loadIntegrations ?? !options.provider;
	const reloadIntegrations = async (): Promise<void> => {
		if (!shouldLoadIntegrations) {
			integrationTools = [];
			return;
		}
		integrationTools = await buildRemoteMcpTools({ sources: linkedMcpSources() });
	};
	const reloadExtraMcp = async (): Promise<void> => {
		const nextTools: McpToolDefinition[] = [];
		const nextClosers: Array<() => void> = [];
		for (const mcp of config.mcp) {
			try {
				const loaded = await loadStdioMcpTools({ ...mcp, cwd });
				nextTools.push(...loaded.tools);
				nextClosers.push(loaded.close);
			} catch {
				// fail-soft: missing extra MCP must not block the REPL
			}
		}
		for (const server of listUserMcpServers(cwd)) {
			try {
				if (server.kind === "stdio" && server.command) {
					const loaded = await loadStdioMcpTools({
						command: server.command,
						args: server.args,
						env: server.env,
						cwd,
						namePrefix: userMcpToolPrefix(server.id),
					});
					nextTools.push(...loaded.tools);
					nextClosers.push(loaded.close);
				} else if (server.kind === "http" && server.url) {
					const tools = await buildRemoteMcpTools({
						sources: [
							{
								connectorId: userMcpToolPrefix(server.id),
								label: server.label,
								mcpUrl: server.url,
								accessToken: server.token ?? "",
							},
						],
					});
					nextTools.push(...tools);
				}
			} catch {
				// fail-soft: a bad user MCP must not block the REPL
			}
		}
		for (const close of extraMcpClosers) close();
		extraMcpClosers = nextClosers;
		extraMcpTools = nextTools;
	};
	await reloadIntegrations();
	await reloadExtraMcp();

	// Browser (browser-use over MCP). Started lazily so non-browser users never pay for it.
	let browserStart: Promise<BrowserSession> | undefined;
	let browserSticky = false;
	let browserTools: McpToolDefinition[] = [];
	let browserNote = "";
	const resolveBrowser = async (message: string): Promise<void> => {
		browserTools = [];
		browserNote = "";
		const access = browserAccess(config.browser);
		if (access === "off" || mode !== "agent") return;
		if (mentionsBrowser(message)) browserSticky = true;
		if (access !== "always" && !browserSticky) return;
		try {
			browserStart ??= startBrowserTools(config.browser, cwd, options.browserLoader);
			browserTools = (await browserStart).tools;
			browserNote = browserPrompt();
		} catch (err) {
			browserStart = undefined;
			browserNote = browserFailurePrompt(browserSetupHint(err));
		}
	};

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
	const makeProvider = (id: string, title?: string): MainModelProvider =>
		options.provider ??
		constructOpenRouterProvider({
			apiKey,
			model: id,
			baseUrl: or.baseUrl,
			sessionId: () => activeSessionId,
			...(title ? { title } : {}),
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
			...extraMcpTools,
			...integrationTools,
			...browserTools,
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
			browserNote,
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
			if (id !== activeSessionId) browserSticky = false;
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
			if (id !== activeSessionId) browserSticky = false;
			activeSessionId = id;
		},
		allowExecAlways() {
			alwaysAllow.add("exec");
		},
		allowRiskyAlways(toolName) {
			alwaysAllow.add(toolName);
			if (isFileWriteTool(toolName)) {
				alwaysAllow.add("write_file");
				alwaysAllow.add("edit_file");
			}
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
		async reloadExtraMcp() {
			await reloadExtraMcp();
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
			const name = skillNameFromCatalogId(source);
			if (isBundledCatalogId(source) && name && isSkillDisabled(cwd, name)) {
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
				const extra =
					result.choices && result.choices.length > 1 && result.choices.length <= 8
						? ` Available: ${result.choices.join(", ")}`
						: "";
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
			const loaded = findSkillForCatalogId(skills, name);
			if (loaded && loaded.source !== "user") {
				disableSkills(cwd, loaded.name);
				runtime.reloadSkills();
				return { ok: true };
			}
			const result = removeSkillFromRoots(loaded?.catalogRef ?? name, removableRoots());
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
			const userText = turnOptions?.displayMessage ?? message;
			const decisions: ResolvedDecisions | undefined =
				options.provider && options.decisions !== true
					? undefined
					: resolveDecisions(config, apiKey, or.baseUrl, process.env, options.decisionsFetch);
			const approval: ApprovalGate = createExecApprovalGate({
				policy,
				alwaysAllow,
				emit,
				assist: decisions?.approvals
					? (req) => classifyToolApproval(decisions, req, userText, turnOptions?.signal)
					: undefined,
				resolveUploadEdit: (path) => matchUploadEdit(cwd, path),
				promptOnly: turnOptions?.promptOnly,
				ask: async (req) => {
					if (turnOptions?.approvalAsk) return turnOptions.approvalAsk(req);
					if (policy === "prompt") return false;
					return true;
				},
			});
			activeEmit = emit;
			activeApproval = approval;
			await resolveBrowser(userText);
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
			const memoryOn = isMemoryEnabled({ configEnabled: config.memory?.enabled });
			const deps: RunTurnDeps = {
				cwd,
				name: config.name,
				systemPrompt: [systemPromptWithMemory(systemPrompt, cwd, userText, memoryOn), browserNote]
					.filter(Boolean)
					.join("\n\n"),
				tools,
				approval,
				store,
				provider,
				constructAgent,
				resolveProvider: options.provider ? undefined : (id, title) => makeProvider(id, title),
				summarize: defaultSummarizer(provider),
				observability,
				traceName: "agent_turn",
				requestType: "chat",
				agentVersion,
				hooks,
				mode,
				decisions,
				shortcut: options.shortcut,
				intercept: options.intercept,
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
					...(turnOptions?.displayMessage !== undefined
						? { displayMessage: turnOptions.displayMessage }
						: {}),
					...(turnOptions?.systemAppend ? { systemAppend: turnOptions.systemAppend } : {}),
					...(turnOptions?.excludeTools?.length ? { excludeTools: turnOptions.excludeTools } : {}),
					...(turnOptions?.hostData ? { hostData: turnOptions.hostData } : {}),
				},
				capture,
				{ signal: turnOptions?.signal },
			);
			// Assign the variable, not the setter: a new chat's first turn must keep the browser on.
			if (session) activeSessionId = session.id;
			scheduleMemoryExtract(memoryOn, cwd, session, provider, decisions);
			return session;
		},
		close() {
			for (const close of extraMcpClosers) close();
			void browserStart?.then(
				(started) => started.close(),
				() => undefined,
			);
			void observability.flush();
		},
	};
	return runtime;
}

function systemPromptWithMemory(
	base: string,
	cwd: string,
	message: string,
	enabled: boolean,
): string {
	if (!enabled) return base;
	const block = formatRetrievedMemory(searchFacts(cwd, message));
	if (!block) return base;
	return `${base}\n\n## Memory\n${block}`;
}

function scheduleMemoryExtract(
	enabled: boolean,
	cwd: string,
	session: Session | undefined,
	provider: MainModelProvider,
	decisions?: ResolvedDecisions,
): void {
	if (!enabled || !session) return;
	void (async () => {
		if (decisions?.memory) {
			const source = turnMemorySource(session);
			if (!source.trim() || !(await turnHasDurableFact(decisions, source))) return;
		}
		await extractMemories({ cwd, session, provider });
	})().catch(() => undefined);
}
