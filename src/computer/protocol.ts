/** Typed messages between the TypeScript harness and the Swift macOS bridge. */

export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export const BRIDGE_KINDS = [
	"task",
	"cancel",
	"confirm_result",
	"routine_save_result",
	"ui.status",
	"ui.confirm",
	"ui.choose",
	"world.get",
	"ui.askRoutineSave",
	"voice.speak",
	"ax.snapshot",
	"ax.press",
	"ax.pressName",
	"ax.pressCompose",
	"ax.setValue",
	"ax.type",
	"ax.keys",
	"ax.frame",
	"ax.clickAt",
	"ax.windowFrame",
	"overlay.moveTo",
	"screen.capture",
	"takeover.request",
	"takeover.move",
	"takeover.click",
	"takeover.drag",
	"takeover.key",
	"takeover.type",
	"takeover.end",
] as const;

export type BridgeKind = (typeof BRIDGE_KINDS)[number];

export interface BridgeEnvelope<K extends string = string, P = unknown> {
	v: typeof BRIDGE_PROTOCOL_VERSION;
	id: string;
	kind: K;
	payload: P;
}

export interface TaskPayload {
	id: string;
	transcript: string;
}

export interface CancelPayload {
	taskId: string;
}

export interface ConfirmResultPayload {
	requestId: string;
	approved: boolean;
}

export interface RoutineSaveResultPayload {
	requestId: string;
	name: string | null;
}

export interface UiStatusPayload {
	label: string;
}

export interface UiConfirmPayload {
	summary: string;
}

export interface UiAskRoutineSavePayload {
	summary: string;
}

export interface VoiceSpeakPayload {
	text: string;
}

export interface AxSnapshotPayload {
	app?: string;
}

export interface AxPressPayload {
	ref: string;
}

export interface AxPressNamePayload {
	name: string;
}

export interface AxSetValuePayload {
	ref: string;
	value: string;
}

export interface AxKeysPayload {
	combo: string;
}

export interface AxFramePayload {
	ref: string;
}

export interface OverlayMoveToPayload {
	x: number;
	y: number;
	label?: string;
}

export interface ScreenCapturePayload {
	marks: boolean;
}

export type BridgeErrorCode = "unknown_kind" | "bad_payload" | "failed";

export interface BridgeErrorPayload {
	code: BridgeErrorCode;
	message: string;
}

export function isBridgeKind(kind: string): kind is BridgeKind {
	return (BRIDGE_KINDS as readonly string[]).includes(kind);
}

export function parseBridgeEnvelope(raw: unknown): BridgeEnvelope | BridgeErrorPayload {
	if (!raw || typeof raw !== "object") {
		return { code: "bad_payload", message: "Envelope must be an object." };
	}
	const rec = raw as Record<string, unknown>;
	if (rec.v !== BRIDGE_PROTOCOL_VERSION) {
		return { code: "bad_payload", message: "Unsupported protocol version." };
	}
	if (typeof rec.id !== "string" || !rec.id.trim()) {
		return { code: "bad_payload", message: "Missing id." };
	}
	if (typeof rec.kind !== "string") {
		return { code: "bad_payload", message: "Missing kind." };
	}
	if (!isBridgeKind(rec.kind)) {
		return { code: "unknown_kind", message: `Unknown message kind "${rec.kind}".` };
	}
	return {
		v: BRIDGE_PROTOCOL_VERSION,
		id: rec.id,
		kind: rec.kind,
		payload: rec.payload,
	};
}

export function bridgeEnvelope<K extends BridgeKind>(
	id: string,
	kind: K,
	payload: unknown,
): BridgeEnvelope<K> {
	return { v: BRIDGE_PROTOCOL_VERSION, id, kind, payload };
}
