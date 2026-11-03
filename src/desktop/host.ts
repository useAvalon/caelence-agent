import type { HarnessRuntime, HarnessTurnOptions } from "../runtime.ts";

/**
 * Extension points for a host app built on the desktop bridge, such as a native widget that
 * talks to it over loopback HTTP. Everything is optional. A host that sets nothing gets the
 * same bridge the desktop window uses.
 */
export interface BridgeHost {
	/**
	 * Extra routes, keyed `"METHOD /path"`. They sit behind the same bearer token as the built-in
	 * routes, and a host route replaces a built-in route with the same key.
	 */
	routes?: Record<string, (ctx: BridgeHostContext, req: Request, url: URL) => Promise<Response>>;
	/** Extra fields merged into `GET /settings` and the `POST /settings` reply. */
	settings?: (ctx: BridgeHostContext) => Record<string, unknown>;
	/**
	 * Handle fields of a `POST /settings` body that the bridge does not know. Return an error
	 * message to reject the request with 400, or nothing to accept it.
	 */
	applySettings?: (
		ctx: BridgeHostContext,
		body: Record<string, unknown>,
	) => string | undefined | Promise<string | undefined>;
	/** Extra rows for `GET /models`, listed before the built-in ones. */
	modelItems?: (ctx: BridgeHostContext) => Array<{ id: string; label: string }>;
	/**
	 * Rewrite stored user and assistant text before it is sent as a transcript, for example to
	 * remove a prefix the host adds to messages.
	 */
	displayText?: (text: string) => string;
	/**
	 * Turn a `POST /turn` request into per-turn options. `message` is what the user typed. Return
	 * `message` to change what the model sees and `options` to shape the turn. Return `reply` to
	 * answer without running the model at all, for example a placeholder for an empty recording.
	 */
	beforeTurn?: (
		ctx: BridgeHostContext,
		input: { message: string; body: Record<string, unknown> },
	) => BridgeTurnPlan | undefined | Promise<BridgeTurnPlan | undefined>;
}

export interface BridgeTurnPlan {
	/** What the model sees. Defaults to the user's message. */
	message?: string;
	/**
	 * What the chat stores and titles the conversation with. Set it when the incoming message
	 * already carries a host prefix that should not show up in the chat. Defaults to the user's
	 * message, or to the original message when `message` is changed.
	 */
	displayMessage?: string;
	/** Per-turn options passed to `runTurn`. The bridge sets `displayMessage` for you. */
	options?: Omit<HarnessTurnOptions, "signal" | "approvalAsk" | "editUserTurn" | "displayMessage">;
	/** Answer with this text and skip the model. */
	reply?: string;
}

export interface BridgeHostContext {
	harness: HarnessRuntime;
}
