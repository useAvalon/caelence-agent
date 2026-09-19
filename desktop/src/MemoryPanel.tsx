import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../src/core/errors";
import { type BridgeClient, getMemory, type PublicMemoryFact, saveMemory } from "./api";
import type { ShowNotice } from "./desk-types";

export function MemoryPanel(
	props: Readonly<{
		bridge: BridgeClient;
		onNotice: ShowNotice;
	}>,
): ReactElement {
	const [enabled, setEnabled] = useState(false);
	const [facts, setFacts] = useState<PublicMemoryFact[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const next = await getMemory(props.bridge);
		setEnabled(next.enabled);
		setFacts(next.facts);
		setLoaded(true);
	}, [props.bridge]);

	useEffect(() => {
		void refresh().catch((err: unknown) => {
			props.onNotice(errorMessage(err), "error");
		});
	}, [props.onNotice, refresh]);

	const setOn = (next: boolean) => {
		void (async () => {
			try {
				const result = await saveMemory(props.bridge, { enabled: next });
				setEnabled(result.enabled);
				setFacts(result.facts);
			} catch (err) {
				props.onNotice(errorMessage(err), "error");
			}
		})();
	};

	return (
		<div className="desk-integrations">
			<p className="desk-integrations-lead">Keeps prefs and decisions for later chats.</p>
			<div className="desk-pane-tabs desk-pane-tabs--compact" role="tablist" aria-label="Memory">
				<button type="button" className={!enabled ? "is-on" : ""} onClick={() => setOn(false)}>
					Off
				</button>
				<button
					type="button"
					className={enabled ? "is-on is-live" : ""}
					onClick={() => setOn(true)}
				>
					On
				</button>
			</div>
			{!loaded ? (
				<p className="desk-side-empty">Loading memory</p>
			) : (
				<ul className="desk-integration-list">
					{facts.map((fact) => (
						<li key={fact.id}>
							<span className="desk-integration-glyph desk-integration-mark" aria-hidden="true">
								{fact.scope === "user" ? "USR" : "PRJ"}
							</span>
							<div>
								<p>{fact.text}</p>
								<em>{fact.scope === "user" ? "Every project" : "This project"}</em>
							</div>
							<div className="desk-integration-actions">
								{fact.pinned ? (
									<span className="desk-integration-ok">
										<CheckIcon size={16} weight="regular" aria-hidden="true" />
										Pinned
									</span>
								) : (
									<button
										type="button"
										className="cel-btn cel-btn--secondary cel-btn--compact"
										disabled={pendingId === fact.id}
										onClick={() => {
											if (pendingId) return;
											setPendingId(fact.id);
											void (async () => {
												try {
													const result = await saveMemory(props.bridge, { pin: fact.id });
													setFacts(
														result.facts.map((item) =>
															item.id === fact.id ? { ...item, pinned: true } : item,
														),
													);
													props.onNotice(
														fact.scope === "user"
															? "Pinned to ~/.harness/AGENTS.md"
															: "Pinned to AGENTS.md",
													);
												} catch (err) {
													props.onNotice(errorMessage(err), "error");
												} finally {
													setPendingId(null);
												}
											})();
										}}
									>
										Pin
									</button>
								)}
								<button
									type="button"
									className="cel-btn cel-btn--danger cel-btn--compact"
									disabled={pendingId === fact.id}
									onClick={() => {
										if (pendingId) return;
										setPendingId(fact.id);
										void (async () => {
											try {
												const result = await saveMemory(props.bridge, { delete: fact.id });
												setFacts(result.facts);
												props.onNotice("Deleted");
											} catch (err) {
												props.onNotice(errorMessage(err), "error");
											} finally {
												setPendingId(null);
											}
										})();
									}}
								>
									Delete
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
