import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "./ids.ts";

export const CHARS_PER_TOKEN = 4;
export const COMPACTION_THRESHOLD_RATIO = 0.6;
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

export type SessionMessage =
	| { kind: "system"; text: string }
	| { kind: "turn"; role: "user" | "assistant"; content: string }
	| { kind: "thought"; text: string }
	| {
			kind: "tool";
			name: string;
			callId: string;
			status: "ok" | "fail";
			preview: string;
			error?: string;
			output?: string;
	  }
	| {
			kind: "compaction_checkpoint";
			summary: string;
			coversFromSeq: number;
			coversToSeq: number;
	  };

export type ChatTranscriptLine =
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string }
	| { kind: "thought"; text: string }
	| {
			kind: "tool";
			name: string;
			callId: string;
			status: "ok" | "fail";
			preview: string;
			error?: string;
			output?: string;
	  };

export interface Session {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	model?: string;
	messages: SessionMessage[];
}

export interface SummarizerInput {
	session: Session;
	messages: SessionMessage[];
	coversFromSeq: number;
	coversToSeq: number;
}

export type SummarizerFn = (input: SummarizerInput) => Promise<string>;

export function estimateTokens(messages: SessionMessage[]): number {
	let chars = 0;
	for (const message of messages) chars += JSON.stringify(message).length;
	return Math.floor(chars / CHARS_PER_TOKEN);
}

/** Highest `coversToSeq` among compaction checkpoints, or `-1` if none. */
export function latestCompactionCover(session: Session): number {
	let covered = -1;
	for (const message of session.messages) {
		if (message.kind !== "compaction_checkpoint") continue;
		if (message.coversToSeq > covered) covered = message.coversToSeq;
	}
	return covered;
}

/** Tokens the next turn would send: summaries plus uncovered turns. */
export function liveContextTokens(session: Session): number {
	const coveredThrough = latestCompactionCover(session);
	let chars = 0;
	for (const summary of compactionSummaries(session)) chars += summary.length;
	session.messages.forEach((message, seq) => {
		if (seq <= coveredThrough) return;
		chars += JSON.stringify(message).length;
	});
	return Math.floor(chars / CHARS_PER_TOKEN);
}

export function normalizeSessionTitle(raw: string, maxLen = 48): string {
	const collapsed = raw.replace(/\s+/g, " ").trim();
	if (!collapsed) return "";
	if (collapsed.length <= maxLen) return collapsed;
	return `${collapsed.slice(0, maxLen - 1).trimEnd()}…`;
}

export function titleFromUserMessage(message: string, maxLen = 48): string {
	return normalizeSessionTitle(message, maxLen) || "New chat";
}

export function sessionToProviderMessages(session: Session): Array<{
	role: "user" | "assistant";
	content: string;
}> {
	const coveredThrough = latestCompactionCover(session);
	const out: Array<{ role: "user" | "assistant"; content: string }> = [];
	session.messages.forEach((message, seq) => {
		if (message.kind !== "turn") return;
		if (seq <= coveredThrough) return;
		out.push({ role: message.role, content: message.content });
	});
	return out;
}

export function sessionTranscript(session: Session): ChatTranscriptLine[] {
	const lines: ChatTranscriptLine[] = [];
	for (const message of session.messages) {
		if (message.kind === "turn" && message.role === "user") {
			lines.push({ kind: "user", text: message.content });
		} else if (message.kind === "turn" && message.role === "assistant") {
			lines.push({ kind: "assistant", text: message.content });
		} else if (message.kind === "thought") {
			lines.push({ kind: "thought", text: message.text });
		} else if (message.kind === "tool") {
			lines.push({
				kind: "tool",
				name: message.name,
				callId: message.callId,
				status: message.status,
				preview: message.preview,
				...(message.error ? { error: message.error } : {}),
				...(message.output ? { output: message.output } : {}),
			});
		}
	}
	return lines;
}

export function compactionSummaries(session: Session): string[] {
	return session.messages
		.filter(
			(m): m is Extract<SessionMessage, { kind: "compaction_checkpoint" }> =>
				m.kind === "compaction_checkpoint",
		)
		.map((m) => m.summary);
}

function findLastCheckpointIndex(messages: SessionMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.kind === "compaction_checkpoint") return i;
	}
	return -1;
}

export interface SessionStore {
	create(systemText: string, model?: string): Promise<Session>;
	get(id: string): Promise<Session | undefined>;
	list(): Promise<Session[]>;
	append(session: Session, message: SessionMessage): Promise<Session>;
	save(session: Session): Promise<Session>;
	setTitle(session: Session, title: string): Promise<Session>;
	remove(id: string): Promise<boolean>;
	maybeCompact(
		session: Session,
		contextWindowTokens: number,
		summarize: SummarizerFn,
	): Promise<Session>;
}

/** Replace a user turn and drop everything after it, including later checkpoints. */
export function replaceUserTurn(session: Session, userTurnIndex: number, content: string): Session {
	const trimmed = content.trim();
	if (!trimmed) throw new Error("Message is empty.");
	let seen = -1;
	let cut = -1;
	for (let i = 0; i < session.messages.length; i++) {
		const message = session.messages[i];
		if (message?.kind === "turn" && message.role === "user") {
			seen++;
			if (seen === userTurnIndex) {
				cut = i;
				break;
			}
		}
	}
	if (cut < 0) throw new Error("No user message to edit.");
	const kept = session.messages.slice(0, cut).filter((message) => {
		if (message.kind !== "compaction_checkpoint") return true;
		return message.coversToSeq < cut;
	});
	return {
		...session,
		title: userTurnIndex === 0 ? titleFromUserMessage(trimmed) : session.title,
		messages: [...kept, { kind: "turn", role: "user", content: trimmed }],
	};
}

export function sessionsDir(cwd: string): string {
	return join(cwd, ".harness", "sessions");
}

function sessionPath(dir: string, id: string): string {
	return join(dir, `${id}.json`);
}

async function persist(dir: string, session: Session): Promise<Session> {
	await mkdir(dir, { recursive: true });
	const next = { ...session, updatedAt: new Date().toISOString() };
	await writeFile(sessionPath(dir, next.id), `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}

export function createFileSessionStore(cwd: string): SessionStore {
	const dir = sessionsDir(cwd);
	return {
		async create(systemText, model) {
			const now = new Date().toISOString();
			const session: Session = {
				id: newId("ses"),
				title: "New chat",
				createdAt: now,
				updatedAt: now,
				model,
				messages: [{ kind: "system", text: systemText }],
			};
			return persist(dir, session);
		},
		async get(id) {
			try {
				const raw = await readFile(sessionPath(dir, id), "utf8");
				return JSON.parse(raw) as Session;
			} catch {
				return undefined;
			}
		},
		async list() {
			try {
				const names = await readdir(dir);
				const sessions: Session[] = [];
				for (const name of names) {
					if (!name.endsWith(".json")) continue;
					const raw = await readFile(join(dir, name), "utf8");
					sessions.push(JSON.parse(raw) as Session);
				}
				sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
				return sessions;
			} catch {
				return [];
			}
		},
		async append(session, message) {
			const next: Session = {
				...session,
				messages: [...session.messages, message],
			};
			return persist(dir, next);
		},
		async save(session) {
			return persist(dir, session);
		},
		async setTitle(session, title) {
			const next = { ...session, title };
			await mkdir(dir, { recursive: true });
			await writeFile(sessionPath(dir, next.id), `${JSON.stringify(next, null, 2)}\n`, "utf8");
			return next;
		},
		async remove(id) {
			try {
				await unlink(sessionPath(dir, id));
				return true;
			} catch {
				return false;
			}
		},
		async maybeCompact(session, contextWindowTokens, summarize) {
			return compactSession(session, contextWindowTokens, summarize, (next) => persist(dir, next));
		},
	};
}

/** Ephemeral sessions for subagents — not listed in `/resume`. */
export function createMemorySessionStore(): SessionStore {
	const byId = new Map<string, Session>();
	const save = async (session: Session): Promise<Session> => {
		const next = { ...session, updatedAt: new Date().toISOString() };
		byId.set(next.id, next);
		return next;
	};
	return {
		async create(systemText, model) {
			const now = new Date().toISOString();
			return save({
				id: newId("ses"),
				title: "subagent",
				createdAt: now,
				updatedAt: now,
				model,
				messages: [{ kind: "system", text: systemText }],
			});
		},
		async get(id) {
			return byId.get(id);
		},
		async list() {
			return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		},
		async append(session, message) {
			return save({ ...session, messages: [...session.messages, message] });
		},
		async save(session) {
			return save(session);
		},
		async setTitle(session, title) {
			const next = { ...session, title };
			byId.set(next.id, next);
			return next;
		},
		async remove(id) {
			return byId.delete(id);
		},
		async maybeCompact(session, contextWindowTokens, summarize) {
			return compactSession(session, contextWindowTokens, summarize, save);
		},
	};
}

async function compactSession(
	session: Session,
	contextWindowTokens: number,
	summarize: SummarizerFn,
	save: (session: Session) => Promise<Session>,
): Promise<Session> {
	const threshold = contextWindowTokens * COMPACTION_THRESHOLD_RATIO;
	if (liveContextTokens(session) < threshold) return session;
	const lastCheckpointIndex = findLastCheckpointIndex(session.messages);
	const coversFromSeq = lastCheckpointIndex + 1;
	const coversToSeq = session.messages.length - 1;
	if (coversFromSeq > coversToSeq) return session;
	const span = session.messages.slice(coversFromSeq, coversToSeq + 1);
	let summary: string;
	try {
		summary = await summarize({ session, messages: span, coversFromSeq, coversToSeq });
	} catch {
		return session;
	}
	return save({
		...session,
		messages: [
			...session.messages,
			{ kind: "compaction_checkpoint", summary, coversFromSeq, coversToSeq },
		],
	});
}
