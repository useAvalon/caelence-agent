import { useCallback, useEffect, useState } from "react";
import {
	type BridgeClient,
	type DesktopState,
	getIntegrations,
	getSessions,
	getState,
	type PickerItem,
	type PublicIntegration,
	postSession,
	resolveBridge,
} from "./api";
import type { MainView, PendingApproval, UiStatus } from "./desk-types";
import { linesFromTranscript, type StreamLine } from "./stream";

export function useDeskRuntime() {
	const [bridge, setBridge] = useState<BridgeClient | null>(null);
	const [bootError, setBootError] = useState<string | null>(null);
	const [state, setState] = useState<DesktopState | null>(null);
	const [sessions, setSessions] = useState<PickerItem[]>([]);
	const [lines, setLines] = useState<StreamLine[]>([]);
	const [status, setStatus] = useState<UiStatus>("boot");
	const [view, setView] = useState<MainView>("chat");
	const [skillQuery, setSkillQuery] = useState("");
	const [pending, setPending] = useState<PendingApproval | null>(null);
	const [integrations, setIntegrations] = useState<PublicIntegration[]>([]);

	const refreshSessions = useCallback(async (client: BridgeClient) => {
		const result = await getSessions(client);
		setSessions(result.items);
	}, []);

	useEffect(() => {
		let cancelled = false;
		const timer = window.setTimeout(() => {
			if (!cancelled) {
				setBootError(
					(current) =>
						current ??
						"Caelence agent is taking too long to start. Close the window and run it again.",
				);
			}
		}, 12_000);
		void (async () => {
			try {
				const client = await resolveBridge();
				const next = await getState(client);
				const listed = await getSessions(client);
				if (cancelled) return;
				setBridge(client);
				setState(next);
				setSessions(listed.items);
				if (next.sessionId) {
					const loaded = await postSession(client, { id: next.sessionId });
					if (cancelled) return;
					setState(loaded.state);
					setLines(linesFromTranscript(loaded.messages ?? []));
				}
				setStatus("idle");
			} catch (err) {
				if (cancelled) return;
				setBootError(
					err instanceof Error ? err.message : "Caelence agent could not reach the local runtime.",
				);
			} finally {
				window.clearTimeout(timer);
			}
		})();
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, []);

	useEffect(() => {
		if (!bridge) return;
		let cancelled = false;
		void getIntegrations(bridge)
			.then((result) => {
				if (!cancelled) setIntegrations(result.items);
			})
			.catch(() => {
				if (!cancelled) setIntegrations([]);
			});
		return () => {
			cancelled = true;
		};
	}, [bridge]);

	return {
		bridge,
		bootError,
		state,
		setState,
		sessions,
		lines,
		setLines,
		status,
		setStatus,
		view,
		setView,
		skillQuery,
		setSkillQuery,
		pending,
		setPending,
		integrations,
		refreshSessions,
	};
}
