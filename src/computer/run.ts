import { BERRY_CHAT_MODEL } from "../cli/models.ts";
import type { AgentEventEmitter, MainModelProvider } from "../core/events.ts";
import { newId } from "../core/ids.ts";
import {
	extractAppHint,
	extractBrowserApp,
	extractSiteHint,
	lastUserAsk,
	looksLikeRefusal,
	readSite,
	saveTargetName,
} from "../decisions/screen-shortcut.ts";
import { answerAboutBufferedFrame, draftSocialPostFromFrame } from "../desktop/berry-computer.ts";
import { hostOfUrl, showPageInBrowser } from "./browser/applescript-driver.ts";
import { BrowserSession } from "./browser/session.ts";
import {
	catalogPageBody,
	connectCatalog,
	decideCatalog,
	declineCatalog,
	runConnectedCatalog,
} from "./capability.ts";
import { drawChartShapes, wantsChartDraw } from "./chart.ts";
import { extractQuotedCopy, stripDraftWrapper, tabReadingText, withoutAsk } from "./compose.ts";
import { type ComputerLoopResult, runComputerLoop } from "./loop.ts";
import { nativeBridge } from "./native/client.ts";
import { planScreenWork } from "./plan.ts";
import { setScreenContext } from "./prompt.ts";
import { routeComputerTask } from "./router.ts";
import { openApp } from "./shell.ts";
import { appendRunLog } from "./telemetry.ts";
import { createComputerRuntime } from "./tools.ts";

export function shouldUseComputerAgent(message: string, _conversational?: boolean): boolean {
	const route = routeComputerTask(message);
	return route.kind !== "chat";
}

export async function runComputerTask(input: {
	message: string;
	tier1: MainModelProvider;
	tier2: MainModelProvider;
	signal?: AbortSignal;
	emit: AgentEventEmitter;
	autoApprove?: boolean;
}): Promise<ComputerLoopResult> {
	const route = routeComputerTask(input.message);
	const emit = input.emit;
	if (route.kind === "direct") {
		emit({
			kind: "turn_meta",
			routing: "jev_shortcut",
			toolName: route.tool,
		});
		if (route.tool === "open_app") {
			const text = await openApp(route.arg);
			emit({ kind: "text_delta", text });
			return {
				summary: text,
				success: true,
				turns: 0,
				tier: 1,
				finishedBy: "router",
			};
		}
		const browser = new BrowserSession();
		const runtime = createComputerRuntime(browser, { autoApprove: input.autoApprove });
		try {
			if (route.tool === "open_url") {
				await browser.ensureTab(route.arg);
			} else {
				await runtime.run("use_routine", route.arg);
			}
			emit({ kind: "text_delta", text: route.reply });
			return {
				summary: route.reply,
				success: true,
				turns: 0,
				tier: 1,
				finishedBy: "router",
			};
		} finally {
			browser.close();
		}
	}

	const browser = new BrowserSession();
	const runId = newId("run");
	browser.setRunId(runId);
	browser.setTask(input.message);
	const work = planScreenWork(input.message);
	const lookingHere = work.source === "front" && work.put === "reply";
	const runtime = createComputerRuntime(browser, { autoApprove: input.autoApprove });
	const site = work.dest;
	const browserApp = extractBrowserApp(input.message);
	const quoted = extractQuotedCopy(input.message);
	const signal = input.signal;
	const provider = route.kind === "complex" ? input.tier2 : input.tier1;
	const postingOut = route.kind === "complex" && Boolean(site) && work.source !== "front";
	emit({
		kind: "turn_meta",
		routing: "chat",
		modelId: provider.modelId,
	});
	try {
		const world = postingOut
			? { text: "", ageMs: 0, sparse: true, jpeg: undefined as string | undefined }
			: await nativeBridge.world().catch(() => ({
					text: "",
					ageMs: 0,
					sparse: true,
					jpeg: undefined as string | undefined,
				}));
		if (world.text) setScreenContext(world.text);
		if (wantsChartDraw(input.message, world.text)) {
			const frame = await nativeBridge.windowFrame().catch(() => undefined);
			const plot = frame
				? {
						x: frame.x + 80,
						y: frame.y + 80,
						w: Math.max(frame.w - 160, 120),
						h: Math.max(frame.h - 160, 120),
					}
				: { x: 80, y: 80, w: 640, h: 400 };
			const labels = world.text
				.split("\n")
				.map((line, i) => ({ text: line.trim(), x: plot.x - 40, y: plot.y + i * 24 }))
				.filter((row) => row.text);
			const drew = await drawChartShapes({
				world: world.text,
				plot,
				labels,
				app: frontAppName(world.text),
			});
			emit({ kind: "text_delta", text: drew.summary });
			appendRunLog(runId, {
				at: new Date().toISOString(),
				turn: 1,
				tier: 1,
				llmMs: 0,
				actions: 1,
				ladder: "take",
				role: "navigator",
			});
			return {
				summary: drew.summary,
				success: drew.ok,
				turns: 1,
				tier: 1,
				finishedBy: "router",
			};
		}
		if (lookingHere) {
			const started = Date.now();
			const live = await liveViewport(world);
			let summary: string;
			if (live.jpeg) {
				summary = await answerAboutBufferedFrame({
					jpeg: Buffer.from(live.jpeg, "base64"),
					question: input.message,
					caption: live.text,
				});
				emit({ kind: "text_delta", text: summary });
			} else {
				summary = await answerFromContext(
					input.message,
					live.text || "The front window has no readable text yet.",
					provider,
					signal,
					emit,
				);
			}
			appendRunLog(runId, {
				at: new Date().toISOString(),
				turn: 1,
				tier: 1,
				llmMs: Date.now() - started,
				actions: 0,
				frameAgeMs: live.ageMs,
			});
			return {
				summary,
				success: true,
				turns: 1,
				tier: 1,
				finishedBy: "router",
			};
		}
		if (route.kind === "complex") {
			const redo = shouldRedoCompose(input.message);
			const workMessage = redo && lastCompose.task ? lastCompose.task : input.message;
			const planned = planScreenWork(workMessage);
			const dest = planned.dest ?? site;
			const destChanged =
				Boolean(dest) &&
				Boolean(lastCompose.dest) &&
				dest.toLowerCase() !== lastCompose.dest.toLowerCase() &&
				hostOfUrl(dest) !== hostOfUrl(lastCompose.dest);
			if (planned.put === "app" && dest && catalogPageBody(workMessage, lastCompose.copy)) {
				emitComposeProgress(emit, "type");
				const typed = await typeIntoMacApp(dest, lastCompose.copy);
				const summary = await speakWhatHappened({
					task: workMessage,
					happened: typed
						? `Opened ${dest} and pasted the summary into a new note.`
						: `Opened ${dest} but could not paste into it.`,
					copy: lastCompose.copy,
					provider,
					signal,
					emit,
				});
				return { summary, success: typed, turns: 1, tier: 1, finishedBy: "router" };
			}
			if (
				planned.put === "site" &&
				catalogPageBody(workMessage, lastCompose.copy) &&
				(shouldReuseComposeDraft(input.message) ||
					(lastCompose.copy.trim().length > 8 && !redo && !destChanged))
			) {
				emitComposeProgress(emit, "type");
				const typeDest = dest || lastCompose.dest;
				if (typeDest) await browser.ensureTab(typeDest, browserApp);
				else await browser.attachFrontmost(browserApp);
				const typed = await typePostWithRetries(browser, lastCompose.copy);
				const summary = await speakWhatHappened({
					task: workMessage,
					happened: typed
						? `Pasted the draft into the open ${hostOfUrl(typeDest || "") || "page"}.`
						: "Could not paste the draft into the page.",
					copy: lastCompose.copy,
					provider,
					signal,
					emit,
				});
				return { summary, success: typed, turns: 1, tier: 1, finishedBy: "router" };
			}
			if (!redo && destChanged) {
				lastCompose.sourceUrl = "";
				lastCompose.source = "";
			}
			lastCompose.task = workMessage;
			lastCompose.dest = dest ?? "";
			const match = decideCatalog({
				task: workMessage,
				host: dest,
				askedHost: dest,
			});
			if (match && !match.connected) {
				const choice = await nativeBridge.choose(
					`${match.label} can be done directly through its connection. Turn it on?`,
					["Connect", "Not now", "Never"],
				);
				if (choice === "Never" || choice.startsWith("Don't ask")) declineCatalog(match.id);
				else if (choice === "Connect") {
					try {
						await connectCatalog(match.id);
						match.connected = true;
					} catch (err) {
						const line = err instanceof Error ? err.message : "Couldn't connect.";
						emit({ kind: "text_delta", text: line });
					}
				}
			}
			if (match?.connected) {
				const fromOpenTab = planned.source === "front";
				let copy = fromOpenTab
					? ""
					: (catalogPageBody(workMessage, lastCompose.copy || quoted || "") ?? "");
				if (!copy) {
					emitComposeProgress(emit, "read");
					let source = world.text;
					let frameJpeg = world.jpeg;
					if (fromOpenTab) {
						const collected = await readOpenTab(browser, world, browserApp, redo, dest);
						source = collected.source;
						frameJpeg = collected.jpeg;
						if (collected.url) lastCompose.sourceUrl = collected.url;
						lastCompose.source = source;
					}
					const reading = tabReadingText(source);
					if (!reading && !sourceLooksLikePage(source, workMessage) && !frameJpeg) {
						const summary = "I couldn't read the current tab, so I didn't create a page.";
						emit({ kind: "text_delta", text: summary });
						return { summary, success: false, turns: 1, tier: 1, finishedBy: "router" };
					}
					emitComposeProgress(emit, "write");
					copy = stripDraftWrapper(
						await draftPageCopy(workMessage, reading || source, input.tier1, signal),
					);
					if (!catalogPageBody(workMessage, copy) && frameJpeg) {
						copy = await answerAboutBufferedFrame({
							jpeg: Buffer.from(frameJpeg, "base64"),
							question: workMessage,
							caption: reading || source,
						});
					}
				}
				const usable = catalogPageBody(workMessage, copy);
				if (!usable) {
					const summary = "I couldn't write a page from the current tab.";
					emit({ kind: "text_delta", text: summary });
					return { summary, success: false, turns: 1, tier: 1, finishedBy: "router" };
				}
				lastCompose.copy = usable;
				emitComposeProgress(emit, "save");
				const wrote = await runConnectedCatalog(match.id, workMessage, usable);
				const summary =
					wrote?.summary ?? `Couldn't create the page through the ${match.label} connection.`;
				if (wrote?.ok && wrote.url) await showPageInBrowser(wrote.url).catch(() => undefined);
				emit({ kind: "text_delta", text: summary });
				return {
					summary,
					success: wrote?.ok === true,
					turns: 1,
					tier: 1,
					finishedBy: "router",
				};
			}
			emitComposeProgress(emit, "read");
			const readUrl = readSite(workMessage);
			const saveName = saveTargetName(workMessage);
			let source = world.text;
			let frameJpeg = world.jpeg;
			const fromOpenTab = planned.source === "front";
			if (fromOpenTab) {
				const collected = await readOpenTab(browser, world, browserApp, redo, dest);
				source = collected.source;
				frameJpeg = collected.jpeg;
				if (collected.url) lastCompose.sourceUrl = collected.url;
				lastCompose.source = source;
			} else if (readUrl && saveName && !readUrl.toLowerCase().includes(saveName)) {
				await browser.ensureTab(readUrl, browserApp);
				const page = await collectPage(browser);
				source = page.text;
			}
			if (readUrl && saveName && source.trim().length < 80) {
				const summary = "I opened the page, but I couldn't read it, so I didn't write that note.";
				emit({ kind: "text_delta", text: summary });
				return { summary, success: false, turns: 1, tier: 1, finishedBy: "router" };
			}
			if (fromOpenTab && dest && source.trim().length < 80 && !lastCompose.copy) {
				const summary = "I couldn't read the current tab, so I didn't write a post.";
				emit({ kind: "text_delta", text: summary });
				return { summary, success: false, turns: 1, tier: 1, finishedBy: "router" };
			}
			const kept = catalogPageBody(workMessage, lastCompose.copy);
			let copyReady: string | undefined;
			if (kept && !redo) copyReady = kept;
			else if (quoted) copyReady = quoted;
			else {
				emitComposeProgress(emit, "write");
				copyReady = stripDraftWrapper(
					await draftPostCopy(workMessage, source, input.tier1, signal),
				);
				if (!catalogPageBody(workMessage, copyReady) && frameJpeg) {
					copyReady = await draftSocialPostFromFrame({
						jpeg: Buffer.from(frameJpeg, "base64"),
						question: workMessage,
						caption: withoutAsk(workMessage, tabReadingText(source) || source),
					});
				}
			}
			copyReady = catalogPageBody(workMessage, copyReady ?? "") ?? "";
			if (saveName && looksLikeRefusal(copyReady)) {
				const summary = "I didn't save that. It wasn't an analysis of the page.";
				emit({ kind: "text_delta", text: summary });
				return { summary, success: false, turns: 1, tier: 1, finishedBy: "router" };
			}
			const copy = copyReady;
			if (input.signal?.aborted) {
				const summary = "Stopped before typing.";
				emit({ kind: "text_delta", text: summary });
				return { summary, success: false, turns: 1, tier: 1, finishedBy: "router" };
			}
			if (copy) lastCompose.copy = copy;
			const composerPost = planned.put === "site" && !match;
			if ((composerPost || planned.put === "app") && !copy) {
				const summary = "I couldn't read enough from the tab to put it there.";
				emit({ kind: "text_delta", text: summary });
				return { summary, success: false, turns: 1, tier: 1, finishedBy: "router" };
			}
			if (planned.put === "app" && dest) {
				emitComposeProgress(emit, "type");
				const typed = await typeIntoMacApp(dest, copy);
				const summary = await speakWhatHappened({
					task: workMessage,
					happened: typed
						? `Opened ${dest} and pasted the summary into a new note.`
						: `Opened ${dest} but could not paste into it.`,
					copy,
					provider,
					signal,
					emit,
				});
				return { summary, success: typed, turns: 1, tier: 1, finishedBy: "router" };
			}
			if (dest) await browser.ensureTab(dest, browserApp);
			else await browser.attachFrontmost(browserApp);
			emitComposeProgress(emit, "type");
			if (composerPost) {
				const typed = await typePostWithRetries(browser, copy);
				const summary = await speakWhatHappened({
					task: workMessage,
					happened: typed
						? `Pasted the draft on ${hostOfUrl(dest || "") || "the page"}.`
						: "Could not paste the draft into the page.",
					copy,
					provider,
					signal,
					emit,
				});
				return {
					summary,
					success: typed,
					turns: 1,
					tier: 1,
					finishedBy: "router",
				};
			}
			const place = dest ? "fresh" : await browser.placeForDraft(workMessage);
			let typed = false;
			if (copy && copy !== "EMPTY" && place !== "leave") {
				typed =
					place === "blank"
						? await browser.typeIntoCurrentPage(copy)
						: await typePostWithRetries(browser, copy);
			}
			if (typed) {
				const summary = await speakWhatHappened({
					task: workMessage,
					happened: `Pasted the draft on ${hostOfUrl(dest || "") || "the page"}.`,
					copy,
					provider,
					signal,
					emit,
				});
				return {
					summary,
					success: true,
					turns: 1,
					tier: 1,
					finishedBy: "router",
				};
			}
			if (browser.draftWasSent()) {
				const summary = "I sent the text once.";
				emit({ kind: "text_delta", text: summary });
				return {
					summary,
					success: true,
					turns: 1,
					tier: 1,
					finishedBy: "router",
				};
			}
			return await runComputerLoop({
				task: input.message,
				tier: 2,
				provider: input.tier2,
				writer: input.tier2,
				role: "writer",
				runtime,
				signal,
				emit,
				runId,
				seed: dest
					? `The destination is ${dest}. The tab that was already open is only the source. Open that destination if it is not in front, create a new page there with a control on the page, then type the text. Do not ask which tab to use.\n\n${copy}`
					: `Stay in the current app. Create the new page with a control already on the page. Do not navigate to a website. Do not ask which tab to use.\n\n${copy}`,
			});
		}
		return await runComputerLoop({
			task: input.message,
			tier: 1,
			provider: input.tier1,
			writer: input.tier2,
			role: "navigator",
			runtime,
			signal,
			emit,
			runId,
		});
	} finally {
		browser.close();
	}
}

async function liveViewport(seed: {
	text: string;
	ageMs: number;
	jpeg?: string;
}): Promise<{ text: string; ageMs: number; jpeg?: string }> {
	const fresh = await nativeBridge.world().catch(() => seed);
	return fresh.jpeg || fresh.text ? fresh : seed;
}

async function readOpenTab(
	browser: BrowserSession,
	seed: { text: string; ageMs: number; jpeg?: string },
	browserApp: string | undefined,
	redo: boolean,
	dest?: string,
): Promise<{ source: string; jpeg?: string; url: string }> {
	await browser.attachFrontmost(browserApp);
	const here = await browser.currentUrl().catch(() => "");
	const onDest = Boolean(dest && here && hostOfUrl(here) === hostOfUrl(dest));
	if ((redo || onDest) && lastCompose.sourceUrl) {
		await browser.focusExistingTab(lastCompose.sourceUrl);
	}
	const live = await liveViewport(seed);
	const page = await collectPage(browser);
	return {
		source: [live.text, page.text].filter(Boolean).join("\n"),
		jpeg: live.jpeg,
		url: page.url,
	};
}

async function collectPage(browser: BrowserSession): Promise<{ text: string; url: string }> {
	const [snap, url] = await Promise.all([
		browser.snapshot().catch(() => ""),
		browser.currentUrl().catch(() => ""),
	]);
	return { text: snap.slice(0, 12_000), url };
}

async function answerFromContext(
	message: string,
	seen: string,
	provider: MainModelProvider,
	signal: AbortSignal | undefined,
	emit: AgentEventEmitter,
): Promise<string> {
	let text = "";
	for await (const event of provider.stream(
		{
			system:
				"Answer from the screen description. A few sentences. Do not suggest opening another app or site.",
			messages: [{ role: "user", content: `${message}\n\n${seen}` }],
		},
		{ signal },
	)) {
		if (event.type === "text_delta") {
			text += event.text;
			emit({ kind: "text_delta", text: event.text });
		}
	}
	return text.trim() || seen;
}

function sourceLooksLikePage(screen: string, ask: string): boolean {
	const source = screen.trim();
	if (source.length < 80) return false;
	const compact = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
	return !compact(source).includes(compact(ask).slice(0, 48));
}

async function draftPageCopy(
	_message: string,
	screen: string,
	provider: MainModelProvider,
	signal?: AbortSignal,
): Promise<string> {
	const reading = withoutAsk(_message, tabReadingText(screen) || screen.trim());
	if (!reading) return "";
	let text = "";
	for await (const event of provider.stream(
		{
			system:
				"Write a markdown page from the source. Start with a # title you choose. Then the analysis. Do not repeat the user's instruction. No greeting.",
			messages: [
				{
					role: "user",
					content: `Source from the open tab:\n${reading.slice(0, 3_200)}`,
				},
			],
		},
		{ signal },
	)) {
		if (event.type === "text_delta") text += event.text;
	}
	return text.trim();
}

async function draftPostCopy(
	message: string,
	screen: string,
	provider: MainModelProvider,
	signal?: AbortSignal,
): Promise<string> {
	const reading = withoutAsk(message, tabReadingText(screen) || screen.trim());
	if (reading.length < 20) return "";
	let text = "";
	for await (const event of provider.stream(
		{
			system:
				"Reply with only the post. At most 8 short lines of what the source actually reports. Never repeat the user's instruction or the site's generic title. No quotes or preamble.",
			messages: [
				{ role: "user", content: `Source from the open tab:\n${reading.slice(0, 2_400)}` },
			],
		},
		{ signal },
	)) {
		if (event.type === "text_delta") text += event.text;
	}
	return text.trim();
}

export function isFlashModel(modelId: string): boolean {
	return /flash/i.test(modelId) || modelId === BERRY_CHAT_MODEL;
}

const TYPE_FOLLOW_UP = /\b(go ahead|type it|do it|post it|send it|in it|that field)\b/i;
const REDO_FOLLOW_UP = /\b(try again|retry)\b/i;

const lastCompose = {
	task: "",
	copy: "",
	source: "",
	sourceUrl: "",
	dest: "",
};

export function lastComputerComposeTask(): string {
	return lastCompose.task;
}

export function shouldReuseComposeDraft(message: string, draft = lastCompose.copy): boolean {
	if (!catalogPageBody(lastCompose.task || message, draft)) return false;
	if (REDO_FOLLOW_UP.test(message)) return false;
	if (/\binstead\b/i.test(message)) return false;
	const latest = lastUserAsk(message);
	if (TYPE_FOLLOW_UP.test(latest) || TYPE_FOLLOW_UP.test(message)) return true;
	const dest = extractSiteHint(latest) ?? extractSiteHint(message) ?? extractAppHint(latest);
	if (dest && lastCompose.dest && dest.toLowerCase() === lastCompose.dest.toLowerCase())
		return true;
	if (dest && lastCompose.dest && hostOfUrl(dest) === hostOfUrl(lastCompose.dest)) return true;
	if (!dest && lastCompose.dest) return true;
	return false;
}

async function speakWhatHappened(input: {
	task: string;
	happened: string;
	copy?: string;
	provider: MainModelProvider;
	signal?: AbortSignal;
	emit: AgentEventEmitter;
}): Promise<string> {
	let text = "";
	for await (const event of input.provider.stream(
		{
			system:
				"Reply in one or two short sentences as yourself. Say only what actually happened. Do not mention a composer unless one was opened.",
			messages: [
				{
					role: "user",
					content: `The user asked: ${input.task}\nWhat happened: ${input.happened}${
						input.copy ? `\nText:\n${input.copy.slice(0, 600)}` : ""
					}`,
				},
			],
		},
		{ signal: input.signal },
	)) {
		if (event.type === "text_delta") {
			text += event.text;
			input.emit({ kind: "text_delta", text: event.text });
		}
	}
	return text.trim() || input.happened;
}

async function typeIntoMacApp(app: string, copy: string): Promise<boolean> {
	if (!copy.trim()) return false;
	await openApp(app);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const result = await nativeBridge.typeText(copy, app);
	return result === "Typed.";
}

export function shouldRedoCompose(message: string): boolean {
	return REDO_FOLLOW_UP.test(message) && lastCompose.task.trim().length > 8;
}

function emitComposeProgress(emit: AgentEventEmitter, stage: string): void {
	emit({
		kind: "tool_call_start",
		toolName: "compose",
		callId: "compose",
		input: { name: stage },
	});
}

async function typePostWithRetries(browser: BrowserSession, copy: string): Promise<boolean> {
	for (let i = 0; i < 2; i++) {
		if (await browser.typeDraft(copy, { intoExisting: i > 0 })) return true;
	}
	return false;
}

function frontAppName(world: string): string | undefined {
	return world.match(/^app:\s*(.+)$/im)?.[1]?.trim();
}
