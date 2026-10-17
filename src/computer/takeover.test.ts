import { describe, expect, test } from "bun:test";
import {
	applyTakeoverConsent,
	applyTakeoverEvent,
	createTakeoverState,
	restoreTakeover,
	TAKEOVER_MARKER,
} from "./takeover.ts";

describe("takeover session", () => {
	test("unmarked mouse event ends the session and restores focus", () => {
		const started = applyTakeoverConsent(createTakeoverState(), "Allow", {
			app: "Chart",
			previousApp: "Notes",
			x: 10,
			y: 20,
		});
		expect(started.status).toBe("active");
		const ended = applyTakeoverEvent(started, { userData: 0, fromUser: true });
		expect(ended.status).toBe("aborted");
		expect(restoreTakeover(ended)).toEqual({ app: "Notes", x: 10, y: 20 });
	});

	test("marked events keep the session", () => {
		const started = applyTakeoverConsent(createTakeoverState(), "Allow", {
			previousApp: "Notes",
			x: 1,
			y: 2,
		});
		const next = applyTakeoverEvent(started, { userData: TAKEOVER_MARKER, fromUser: false });
		expect(next.status).toBe("active");
	});

	test("Not now skips without aborting", () => {
		const next = applyTakeoverConsent(createTakeoverState(), "Not now", {
			previousApp: "Notes",
			x: 0,
			y: 0,
		});
		expect(next.status).toBe("skipped");
	});
});
