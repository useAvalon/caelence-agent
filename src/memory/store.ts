import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { newId } from "../core/ids.ts";
import { userInstructionsPath } from "../core/instructions.ts";
import { harnessHome } from "../desktop/secrets.ts";

export type MemoryScope = "user" | "project";

export interface MemoryFact {
	id: string;
	hash: string;
	text: string;
	scope: MemoryScope;
	createdAt: string;
	sessionId?: string;
}

interface FactsFile {
	facts: MemoryFact[];
}

const STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"this",
	"that",
	"from",
	"you",
	"your",
	"are",
	"was",
	"were",
	"have",
	"has",
	"not",
	"but",
	"use",
	"using",
]);

const QUESTION_TOKENS = new Set(["what", "whats", "where", "who", "which", "how", "when"]);

export function normalizeFactText(raw: string): string {
	return raw.replace(/\s+/g, " ").trim();
}

export function factHash(text: string): string {
	return createHash("sha256").update(text.toLowerCase()).digest("hex").slice(0, 16);
}

export function isSecretLike(text: string): boolean {
	if (/\bsk-[a-z0-9_-]{8,}\b/i.test(text)) return true;
	if (/\b(api[_-]?key|secret|password|token|bearer)\b\s*[:=]/i.test(text)) return true;
	if (/\beyJ[a-zA-Z0-9_-]{20,}\./.test(text)) return true;
	return false;
}

export function userMemoryPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "memory", "facts.json");
}

export function projectMemoryPath(cwd: string): string {
	return resolve(cwd, ".harness", "memory", "facts.json");
}

function readFactsFile(path: string): MemoryFact[] {
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<FactsFile>;
		return Array.isArray(parsed.facts) ? parsed.facts.filter(isMemoryFact) : [];
	} catch {
		return [];
	}
}

function writeFactsFile(path: string, facts: MemoryFact[]): void {
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ facts }, null, "\t")}\n`);
}

function isMemoryFact(value: unknown): value is MemoryFact {
	if (!value || typeof value !== "object") return false;
	const fact = value as Partial<MemoryFact>;
	return (
		typeof fact.id === "string" &&
		typeof fact.hash === "string" &&
		typeof fact.text === "string" &&
		(fact.scope === "user" || fact.scope === "project") &&
		typeof fact.createdAt === "string"
	);
}

function pathForScope(
	cwd: string,
	scope: MemoryScope,
	env: Record<string, string | undefined> = process.env,
): string {
	return scope === "user" ? userMemoryPath(env) : projectMemoryPath(cwd);
}

export function listFacts(
	cwd: string,
	env: Record<string, string | undefined> = process.env,
): MemoryFact[] {
	return [...readFactsFile(userMemoryPath(env)), ...readFactsFile(projectMemoryPath(cwd))];
}

export function addFacts(
	cwd: string,
	incoming: Array<{ text: string; scope?: MemoryScope; sessionId?: string }>,
	env: Record<string, string | undefined> = process.env,
): MemoryFact[] {
	const known = new Set(listFacts(cwd, env).map((fact) => fact.hash));
	const added: MemoryFact[] = [];
	for (const item of incoming) {
		const text = normalizeFactText(item.text);
		if (text.length < 8 || text.length > 280 || isSecretLike(text)) continue;
		const hash = factHash(text);
		if (known.has(hash)) continue;
		const scope: MemoryScope = item.scope === "user" ? "user" : "project";
		const fact: MemoryFact = {
			id: newId("mem"),
			hash,
			text,
			scope,
			createdAt: new Date().toISOString(),
			...(item.sessionId ? { sessionId: item.sessionId } : {}),
		};
		const path = pathForScope(cwd, scope, env);
		const facts = readFactsFile(path);
		facts.push(fact);
		writeFactsFile(path, facts);
		known.add(hash);
		added.push(fact);
	}
	return added;
}

export function deleteFact(
	cwd: string,
	id: string,
	env: Record<string, string | undefined> = process.env,
): MemoryFact | undefined {
	const trimmed = id.trim();
	if (!trimmed) return undefined;
	for (const scope of ["user", "project"] as const) {
		const path = pathForScope(cwd, scope, env);
		const facts = readFactsFile(path);
		const index = facts.findIndex((fact) => fact.id === trimmed);
		if (index < 0) continue;
		const [removed] = facts.splice(index, 1);
		writeFactsFile(path, facts);
		return removed;
	}
	return undefined;
}

export function matchFact(facts: MemoryFact[], raw: string): MemoryFact | undefined {
	const arg = raw.trim();
	if (!arg) return undefined;
	const index = Number(arg);
	if (Number.isInteger(index) && index >= 1 && index <= facts.length) {
		return facts[index - 1];
	}
	return facts.find((fact) => fact.id === arg || fact.id.endsWith(arg));
}

export function tokenizeMemoryQuery(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function searchFacts(
	cwd: string,
	query: string,
	topK = 10,
	env: Record<string, string | undefined> = process.env,
): MemoryFact[] {
	const facts = listFacts(cwd, env);
	if (facts.length === 0) return [];
	const tokens = tokenizeMemoryQuery(query);
	if (tokens.length === 0) return takeRecentFacts(facts, topK);
	const needle = normalizeFactText(query).toLowerCase();
	const leftover = leftoverNameBoosts(facts, query, tokens);
	const hits = facts
		.map((fact, index) => ({
			fact,
			score: scoreFact(fact, index, facts.length, tokens, needle) + (leftover.get(fact.id) ?? 0),
		}))
		.filter((row) => row.score > 1)
		.sort((a, b) => b.score - a.score)
		.map((row) => row.fact);
	return fillMemoryHits(hits, facts, topK);
}

function stemToken(word: string): string {
	if (word.length >= 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
	return word;
}

function tokensOverlap(hay: string[], token: string): boolean {
	const stem = stemToken(token);
	return hay.some((word) => word === token || stemToken(word) === stem);
}

function isPersonalQuery(query: string): boolean {
	const q = query.toLowerCase();
	const asks = /\b(what'?s|whats|what is|where do|who am|which)\b/.test(q);
	const self = /\b(my|i|i'm|im)\b/.test(q);
	return asks && self;
}

function isCapitalized(word: string): boolean {
	const first = word[0];
	return Boolean(first && first === first.toUpperCase() && first !== first.toLowerCase());
}

function wordsWithCaps(text: string): string[] {
	return text.split(/[^A-Za-z]+/).filter((word) => word.length >= 3);
}

function unboundNames(text: string): string[] {
	const words = wordsWithCaps(text);
	const bound = new Set<string>();
	for (let i = 0; i < words.length - 1; i += 1) {
		if (words[i]?.toLowerCase() === "in" && isCapitalized(words[i + 1] ?? "")) {
			bound.add(words[i + 1] ?? "");
		}
	}
	return words.filter((word, index) => index > 0 && isCapitalized(word) && !bound.has(word));
}

function leftoverNameBoosts(
	facts: MemoryFact[],
	query: string,
	tokens: string[],
): Map<string, number> {
	const boosts = new Map<string, number>();
	if (!isPersonalQuery(query)) return boosts;
	const content = tokens.filter((token) => !QUESTION_TOKENS.has(token));
	const unanswered = content.filter(
		(token) => !facts.some((fact) => tokensOverlap(tokenizeMemoryQuery(fact.text), token)),
	);
	if (unanswered.length === 0) return boosts;
	const leftovers = facts.filter(
		(fact) => fact.scope === "user" && unboundNames(fact.text).length > 0,
	);
	if (leftovers.length !== 1) return boosts;
	const only = leftovers[0];
	if (only) boosts.set(only.id, 4);
	return boosts;
}

function scoreFact(
	fact: MemoryFact,
	index: number,
	total: number,
	tokens: string[],
	needle: string,
): number {
	const hay = fact.text.toLowerCase();
	const words = tokenizeMemoryQuery(fact.text);
	let score = (index + 1) / total;
	if (needle && hay.includes(needle)) score += 5;
	for (const token of tokens) {
		if (tokensOverlap(words, token)) score += 3;
	}
	return score;
}

function takeRecentFacts(facts: MemoryFact[], topK: number): MemoryFact[] {
	return facts.slice(-topK).reverse();
}

function fillMemoryHits(hits: MemoryFact[], all: MemoryFact[], topK: number): MemoryFact[] {
	const out = hits.slice(0, topK);
	const seen = new Set(out.map((fact) => fact.id));
	for (const fact of all.filter((item) => item.scope === "user").reverse()) {
		if (out.length >= topK) break;
		if (seen.has(fact.id)) continue;
		out.push(fact);
		seen.add(fact.id);
	}
	return out.length > 0 ? out : takeRecentFacts(all, topK);
}

export function instructionsPathForFact(
	cwd: string,
	fact: Pick<MemoryFact, "scope">,
	instructionsFile = "AGENTS.md",
	env: Record<string, string | undefined> = process.env,
): string {
	return fact.scope === "user"
		? userInstructionsPath(env)
		: resolve(cwd, instructionsFile.trim() || "AGENTS.md");
}

export function isFactPinned(
	cwd: string,
	fact: Pick<MemoryFact, "scope" | "text">,
	instructionsFile = "AGENTS.md",
	env: Record<string, string | undefined> = process.env,
): boolean {
	const target = instructionsPathForFact(cwd, fact, instructionsFile, env);
	if (!existsSync(target)) return false;
	try {
		return readFileSync(target, "utf8").includes(fact.text.trim());
	} catch {
		return false;
	}
}

export function pinFact(
	cwd: string,
	fact: MemoryFact,
	instructionsFile = "AGENTS.md",
	env: Record<string, string | undefined> = process.env,
): { path: string } | { error: string } {
	const target = instructionsPathForFact(cwd, fact, instructionsFile, env);
	const line = fact.text.trim();
	let current = "";
	if (existsSync(target)) {
		try {
			current = readFileSync(target, "utf8");
		} catch {
			return { error: "Could not read instructions." };
		}
	}
	if (current.includes(line)) return { path: target };
	const next = current.trimEnd() ? `${current.trimEnd()}\n\n${line}\n` : `${line}\n`;
	mkdirSync(resolve(target, ".."), { recursive: true });
	writeFileSync(target, next);
	return { path: target };
}

export function stripPinnedText(current: string, line: string): string | undefined {
	const needle = line.trim();
	if (!needle) return undefined;
	const normalized = current.replaceAll("\r\n", "\n");
	const paragraphs = normalized.split("\n\n");
	const keptParas = paragraphs.filter((para) => para.trim() !== needle);
	if (keptParas.length !== paragraphs.length) {
		const body = keptParas.join("\n\n").trim();
		return body ? `${body}\n` : "";
	}
	const rows = normalized.split("\n");
	const keptRows = rows.filter((row) => row.trim() !== needle);
	if (keptRows.length === rows.length) return undefined;
	let body = keptRows.join("\n");
	while (body.includes("\n\n\n")) body = body.replaceAll("\n\n\n", "\n\n");
	body = body.trim();
	return body ? `${body}\n` : "";
}

export function unpinFact(
	cwd: string,
	fact: Pick<MemoryFact, "scope" | "text">,
	instructionsFile = "AGENTS.md",
	env: Record<string, string | undefined> = process.env,
): { path: string; removed: boolean } | { error: string } {
	const target = instructionsPathForFact(cwd, fact, instructionsFile, env);
	if (!existsSync(target)) return { path: target, removed: false };
	let current: string;
	try {
		current = readFileSync(target, "utf8");
	} catch {
		return { error: "Could not read instructions." };
	}
	const next = stripPinnedText(current, fact.text);
	if (next === undefined) return { path: target, removed: false };
	try {
		writeFileSync(target, next);
	} catch {
		return { error: "Could not write instructions." };
	}
	return { path: target, removed: true };
}
