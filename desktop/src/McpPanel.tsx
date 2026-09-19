import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { type ReactElement, useEffect, useState } from "react";
import { errorMessage } from "../../src/core/errors";
import { addMcp, type BridgeClient, getMcps, type PublicUserMcp, removeMcp } from "./api";

const LOCAL_MCP_PLACEHOLDER = `uvx mcp-server-fetch
or ------------------------
{
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}`;

function mcpGlyph(item: PublicUserMcp): string {
	if (item.kind === "http") return "URL";
	const letters = item.label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2);
	return letters.toUpperCase() || "MCP";
}

function mcpOrigin(item: PublicUserMcp): string {
	if (item.origin === "config") return `${item.detail} · harness.config.ts`;
	return item.detail;
}

function McpActions(
	props: Readonly<{
		item: PublicUserMcp;
		pending: boolean;
		onRemove: () => void;
	}>,
): ReactElement {
	if (props.pending) {
		return (
			<span className="desk-integration-ok">
				<span className="cel-chip__spin" aria-hidden="true" />
				<span>Removing</span>
			</span>
		);
	}
	if (props.item.removable) {
		return (
			<button
				type="button"
				className="cel-btn cel-btn--quiet cel-btn--compact"
				onClick={props.onRemove}
			>
				Remove
			</button>
		);
	}
	return (
		<span className="desk-integration-ok">
			<CheckIcon size={16} weight="regular" aria-hidden="true" />
			In config
		</span>
	);
}

function McpRow(
	props: Readonly<{
		item: PublicUserMcp;
		pending: boolean;
		onRemove: () => void;
	}>,
): ReactElement {
	const { item } = props;
	return (
		<li>
			<span className="desk-integration-glyph desk-integration-mark" aria-hidden="true">
				{mcpGlyph(item)}
			</span>
			<div>
				<p>{item.label}</p>
				<em>{mcpOrigin(item)}</em>
			</div>
			<div className="desk-integration-actions">
				<McpActions item={item} pending={props.pending} onRemove={props.onRemove} />
			</div>
		</li>
	);
}

export function McpPanel(
	props: Readonly<{
		bridge: BridgeClient;
		onNotice: (text: string) => void;
	}>,
): ReactElement {
	const [items, setItems] = useState<PublicUserMcp[] | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [kind, setKind] = useState<"stdio" | "http">("stdio");
	const [label, setLabel] = useState("");
	const [command, setCommand] = useState("");
	const [url, setUrl] = useState("");
	const [token, setToken] = useState("");
	const [busy, setBusy] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		void getMcps(props.bridge)
			.then((result) => {
				if (alive) setItems(result.items);
			})
			.catch((err: unknown) => {
				if (!alive) return;
				setLoadFailed(true);
				props.onNotice(errorMessage(err));
			});
		return () => {
			alive = false;
		};
	}, [props.bridge, props.onNotice]);

	const submit = async (): Promise<void> => {
		setBusy(true);
		try {
			const result = await addMcp(
				props.bridge,
				kind === "http"
					? { kind: "http", label: label.trim() || undefined, url: url.trim(), token: token.trim() }
					: { kind: "stdio", label: label.trim() || undefined, command: command.trim() },
			);
			setItems(result.items);
			setLabel("");
			setCommand("");
			setUrl("");
			setToken("");
		} catch (err) {
			props.onNotice(errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	const drop = async (id: string): Promise<void> => {
		setPendingId(id);
		try {
			const result = await removeMcp(props.bridge, id);
			setItems(result.items);
		} catch (err) {
			props.onNotice(errorMessage(err));
		} finally {
			setPendingId(null);
		}
	};

	if (!items && !loadFailed) {
		return <p>Loading MCP servers</p>;
	}

	if (!items && loadFailed) {
		return <p className="desk-side-empty">MCP servers could not be loaded</p>;
	}

	const listed = items ?? [];
	const canAdd = kind === "http" ? url.trim().length > 0 : command.trim().length > 0;

	return (
		<>
			<p className="desk-integrations-lead">
				Local command or URL MCP servers for this project. Paste a command, or an mcpServers JSON
				block.
			</p>
			<div className="desk-pane-tabs desk-pane-tabs--compact" role="tablist" aria-label="MCP kind">
				<button
					type="button"
					role="tab"
					aria-selected={kind === "stdio"}
					className={kind === "stdio" ? "is-on" : undefined}
					onClick={() => setKind("stdio")}
				>
					Local
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={kind === "http"}
					className={kind === "http" ? "is-on" : undefined}
					onClick={() => setKind("http")}
				>
					URL
				</button>
			</div>
			<form
				className="desk-mcp-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (canAdd && !busy) void submit();
				}}
			>
				<label>
					<span>Name</span>
					<input
						className="cel-input"
						value={label}
						placeholder="Optional"
						onChange={(event) => setLabel(event.target.value)}
					/>
				</label>
				{kind === "http" ? (
					<>
						<label>
							<span>Server URL</span>
							<input
								className="cel-input"
								value={url}
								placeholder="http://127.0.0.1:3100/mcp"
								autoComplete="off"
								spellCheck={false}
								onChange={(event) => setUrl(event.target.value)}
							/>
						</label>
						<label>
							<span>Bearer token</span>
							<input
								className="cel-input"
								type="password"
								value={token}
								placeholder="Optional"
								autoComplete="off"
								spellCheck={false}
								onChange={(event) => setToken(event.target.value)}
							/>
						</label>
					</>
				) : (
					<label>
						<span>Command</span>
						<textarea
							className="cel-input"
							rows={8}
							value={command}
							placeholder={LOCAL_MCP_PLACEHOLDER}
							autoComplete="off"
							spellCheck={false}
							onChange={(event) => setCommand(event.target.value)}
						/>
					</label>
				)}
				<button
					type="submit"
					className="cel-btn cel-btn--secondary cel-btn--compact"
					disabled={!canAdd || busy}
				>
					{busy ? "Adding" : "Add"}
				</button>
			</form>
			{listed.length === 0 ? (
				<p className="desk-side-empty">No MCP servers yet. Add a local command or a URL.</p>
			) : (
				<ul className="desk-integration-list">
					{listed.map((item) => (
						<McpRow
							key={item.id}
							item={item}
							pending={pendingId === item.id}
							onRemove={() => void drop(item.id)}
						/>
					))}
				</ul>
			)}
		</>
	);
}
