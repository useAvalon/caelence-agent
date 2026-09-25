import { useEffect, useState } from "react";
import { errorMessage } from "../../src/core/errors";
import {
	type BridgeClient,
	connectIntegration,
	disconnectIntegration,
	getIntegrations,
	type PublicIntegration,
} from "./api";
import { DeskToggle } from "./DeskToggle";
import type { ShowNotice } from "./desk-types";
import { integrationMatches } from "./integration-search";
import { McpPanel } from "./McpPanel";

export function IntegrationActions(
	props: Readonly<{
		label: string;
		pending: boolean;
		connected: boolean;
		onConnect: () => void;
		onDisconnect: () => void;
	}>,
): React.ReactElement {
	const pendingLabel = props.connected ? "Disconnecting" : "Connecting";
	const idleLabel = props.connected ? `Disconnect ${props.label}` : `Connect ${props.label}`;
	return (
		<DeskToggle
			checked={props.connected}
			pending={props.pending}
			label={props.pending ? pendingLabel : idleLabel}
			onChange={(next) => {
				if (next) props.onConnect();
				else props.onDisconnect();
			}}
		/>
	);
}

export function IntegrationMark(props: Readonly<{ item: PublicIntegration }>): React.ReactElement {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return <span className="desk-integration-glyph desk-integration-mark">{props.item.glyph}</span>;
	}
	return (
		<span className="desk-integration-mark">
			<img src={props.item.logoUrl} alt="" width={20} height={20} onError={() => setFailed(true)} />
		</span>
	);
}

export function IntegrationRow(
	props: Readonly<{
		item: PublicIntegration;
		pending: boolean;
		onConnect: () => void;
		onDisconnect: () => void;
	}>,
): React.ReactElement {
	const { item } = props;
	return (
		<li>
			<IntegrationMark item={item} />
			<div>
				<p>{item.label}</p>
				<em>{item.description}</em>
			</div>
			<div className="desk-integration-actions">
				<IntegrationActions
					label={item.label}
					pending={props.pending}
					connected={item.connected}
					onConnect={props.onConnect}
					onDisconnect={props.onDisconnect}
				/>
			</div>
		</li>
	);
}

export function IntegrationsPanel(
	props: Readonly<{
		bridge: BridgeClient;
		onNotice: ShowNotice;
	}>,
): React.ReactElement {
	const [tab, setTab] = useState<"integrations" | "mcp">("integrations");

	return (
		<div className="desk-integrations">
			<div className="desk-pane-tabs" role="tablist" aria-label="Integrations and MCP">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "integrations"}
					className={tab === "integrations" ? "is-on" : undefined}
					onClick={() => setTab("integrations")}
				>
					Integrations
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "mcp"}
					className={tab === "mcp" ? "is-on" : undefined}
					onClick={() => setTab("mcp")}
				>
					MCP
				</button>
			</div>
			{tab === "mcp" ? (
				<McpPanel bridge={props.bridge} onNotice={props.onNotice} />
			) : (
				<HostedIntegrationsList bridge={props.bridge} onNotice={props.onNotice} />
			)}
		</div>
	);
}

export function HostedIntegrationsList(
	props: Readonly<{
		bridge: BridgeClient;
		onNotice: ShowNotice;
	}>,
): React.ReactElement {
	const [items, setItems] = useState<PublicIntegration[] | null>(null);
	const [query, setQuery] = useState("");
	const [loadFailed, setLoadFailed] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		void getIntegrations(props.bridge)
			.then((result) => {
				if (alive) setItems(result.items);
			})
			.catch((err: unknown) => {
				if (!alive) return;
				setLoadFailed(true);
				props.onNotice(errorMessage(err), "error");
			});
		return () => {
			alive = false;
		};
	}, [props.bridge, props.onNotice]);

	const visible = (items ?? []).filter((item) => integrationMatches(item.label, query));
	const ready = visible.filter(
		(item) => item.auth !== "google" && item.auth !== "microsoft" && item.auth !== "desktop",
	);
	const desktop = visible.filter((item) => item.auth === "desktop");
	const setup = visible.filter((item) => item.auth === "google" || item.auth === "microsoft");

	const run = async (id: string, action: "connect" | "disconnect"): Promise<void> => {
		setPendingId(id);
		try {
			const result =
				action === "connect"
					? await connectIntegration(props.bridge, id)
					: await disconnectIntegration(props.bridge, id);
			setItems(result.items);
			props.onNotice(action === "connect" ? "Connected" : "Disconnected");
		} catch (err) {
			props.onNotice(errorMessage(err), "error");
		} finally {
			setPendingId(null);
		}
	};

	if (!items && !loadFailed) {
		return <p>Loading integrations</p>;
	}

	if (!items && loadFailed) {
		return <p className="desk-side-empty">Integrations could not be loaded</p>;
	}

	return (
		<>
			<p className="desk-integrations-lead">Connect a service the agent can call.</p>
			<label className="desk-field">
				<span className="visually-hidden">Search integrations</span>
				<input
					className="cel-input"
					value={query}
					placeholder="Search"
					onChange={(event) => setQuery(event.target.value)}
				/>
			</label>
			{visible.length === 0 ? (
				<p className="desk-side-empty">No integrations match</p>
			) : (
				<>
					{ready.length > 0 ? (
						<ul className="desk-integration-list">
							{ready.map((item) => (
								<IntegrationRow
									key={item.id}
									item={item}
									pending={pendingId === item.id}
									onConnect={() => void run(item.id, "connect")}
									onDisconnect={() => void run(item.id, "disconnect")}
								/>
							))}
						</ul>
					) : null}
					{desktop.length > 0 ? (
						<>
							<div className="desk-integration-split">
								<p>Figma desktop required</p>
								<em>
									Remote Figma MCP only allows approved clients. Enable the Dev Mode MCP server in
									Figma desktop, then Connect.
								</em>
							</div>
							<ul className="desk-integration-list">
								{desktop.map((item) => (
									<IntegrationRow
										key={item.id}
										item={item}
										pending={pendingId === item.id}
										onConnect={() => void run(item.id, "connect")}
										onDisconnect={() => void run(item.id, "disconnect")}
									/>
								))}
							</ul>
						</>
					) : null}
					{setup.length > 0 ? (
						<>
							<div className="desk-integration-split">
								<p>OAuth client required</p>
								<em>
									Google Workspace and Microsoft 365 have no dynamic client registration. Add a
									client id in Settings, then Connect.
								</em>
							</div>
							<ul className="desk-integration-list">
								{setup.map((item) => (
									<IntegrationRow
										key={item.id}
										item={item}
										pending={pendingId === item.id}
										onConnect={() => void run(item.id, "connect")}
										onDisconnect={() => void run(item.id, "disconnect")}
									/>
								))}
							</ul>
						</>
					) : null}
				</>
			)}
		</>
	);
}
