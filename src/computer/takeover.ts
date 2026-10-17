export const TAKEOVER_MARKER = 0x4341454c;

export type TakeoverStatus = "idle" | "active" | "aborted" | "ended" | "skipped";

export interface TakeoverState {
	status: TakeoverStatus;
	previousApp?: string;
	previousX?: number;
	previousY?: number;
	app?: string;
	untilQuit?: boolean;
}

export function createTakeoverState(): TakeoverState {
	return { status: "idle" };
}

export function applyTakeoverConsent(
	state: TakeoverState,
	choice: "Allow" | "Allow for this app until quit" | "Not now",
	ctx: { app?: string; previousApp?: string; x: number; y: number },
): TakeoverState {
	if (choice === "Not now") {
		return { ...state, status: "skipped" };
	}
	return {
		status: "active",
		app: ctx.app,
		previousApp: ctx.previousApp,
		previousX: ctx.x,
		previousY: ctx.y,
		untilQuit: choice === "Allow for this app until quit",
	};
}

export function applyTakeoverEvent(
	state: TakeoverState,
	event: { userData: number; fromUser: boolean },
): TakeoverState {
	if (state.status !== "active") return state;
	if (event.fromUser && event.userData !== TAKEOVER_MARKER) {
		return { ...state, status: "aborted" };
	}
	return state;
}

export function restoreTakeover(state: TakeoverState): {
	app?: string;
	x?: number;
	y?: number;
} {
	return { app: state.previousApp, x: state.previousX, y: state.previousY };
}

export async function runTakeover(
	native: {
		choose(summary: string, buttons: string[]): Promise<string>;
		takeoverRequest(input: {
			summary: string;
			estimateMs: number;
			app?: string;
		}): Promise<{ skipped?: boolean; aborted?: boolean; ok?: boolean }>;
		takeoverMove(x: number, y: number): Promise<void>;
		takeoverClick(x: number, y: number): Promise<void>;
		takeoverDrag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
		takeoverKey(key: string): Promise<void>;
		takeoverType(text: string): Promise<void>;
		takeoverEnd(): Promise<void>;
	},
	input: { summary: string; estimateMs: number; app?: string },
	run: (api: {
		move(x: number, y: number): Promise<void>;
		click(x: number, y: number): Promise<void>;
		drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
		key(key: string): Promise<void>;
		type(text: string): Promise<void>;
	}) => Promise<void>,
): Promise<{ skipped: boolean; aborted: boolean }> {
	const started = await native.takeoverRequest(input);
	if (started.skipped) return { skipped: true, aborted: false };
	if (started.aborted) return { skipped: false, aborted: true };
	try {
		await run({
			move: (x, y) => native.takeoverMove(x, y),
			click: (x, y) => native.takeoverClick(x, y),
			drag: (from, to) => native.takeoverDrag(from, to),
			key: (key) => native.takeoverKey(key),
			type: (text) => native.takeoverType(text),
		});
		await native.takeoverEnd();
		return { skipped: false, aborted: false };
	} catch {
		await native.takeoverEnd().catch(() => undefined);
		return { skipped: false, aborted: true };
	}
}
