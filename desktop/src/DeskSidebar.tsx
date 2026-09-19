import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear";
import { PlugsIcon } from "@phosphor-icons/react/dist/csr/Plugs";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { PuzzlePieceIcon } from "@phosphor-icons/react/dist/csr/PuzzlePiece";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { LogoMark } from "./LogoMark";
import type { DeskReady } from "./useDesktopApp";

export function DeskSidebar(props: Readonly<{ desk: DeskReady }>): React.ReactElement {
	const {
		state,
		sessions,
		status,
		view,
		sideOpen,
		renamingId,
		renameDraft,
		renameInputRef,
		skipRenameBlurRef,
		setView,
		setSkillQuery,
		setSideOpen,
		setRenamingId,
		setRenameDraft,
		setSessionMenu,
		setPicker,
		setStatus,
		openSession,
		newChat,
		commitRename,
	} = props.desk;
	return (
		<aside className="desk-side">
			<div className="desk-brand">
				<LogoMark size={20} />
				<div className="desk-brand-copy">
					<p className="desk-wordmark">Caelence</p>
					<p className="desk-product">agent</p>
				</div>
				<button
					type="button"
					className="desk-side-toggle"
					aria-pressed={sideOpen}
					aria-label={sideOpen ? "Hide sidebar" : "Show sidebar"}
					onClick={() => setSideOpen((open) => !open)}
				>
					<SidebarSimpleIcon size={16} weight="regular" />
				</button>
			</div>
			<button
				type="button"
				className="desk-settings-btn desk-new"
				disabled={status !== "idle"}
				aria-label="New chat"
				onClick={() => void newChat()}
			>
				<PlusIcon size={16} weight="regular" />
				<span>New chat</span>
			</button>
			<section className="desk-sessions" aria-label="Sessions">
				<div className="desk-sessions-head">
					<h2>Sessions</h2>
					<button
						type="button"
						className={`desk-sessions-more${view === "sessions" ? " is-on" : ""}`}
						aria-label="Session history"
						aria-pressed={view === "sessions"}
						onClick={() => setView((current) => (current === "sessions" ? "chat" : "sessions"))}
					>
						<ClockCounterClockwiseIcon size={16} weight="regular" />
					</button>
				</div>
				{sessions.length === 0 ? (
					<p className="desk-side-empty">No saved sessions</p>
				) : (
					<ul>
						{sessions.map((item) => (
							<li
								key={item.id}
								onContextMenu={(event) => {
									event.preventDefault();
									setPicker(null);
									setStatus((current) => (current === "picker" ? "idle" : current));
									setRenamingId(null);
									setSessionMenu({
										id: item.id,
										label: item.label,
										x: event.clientX,
										y: event.clientY,
									});
								}}
							>
								{renamingId === item.id ? (
									<input
										ref={renameInputRef}
										className="cel-input desk-rename"
										value={renameDraft}
										aria-label="Chat name"
										onChange={(event) => setRenameDraft(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												event.stopPropagation();
												skipRenameBlurRef.current = true;
												void commitRename();
											}
											if (event.key === "Escape") {
												event.preventDefault();
												event.stopPropagation();
												skipRenameBlurRef.current = true;
												setRenamingId(null);
											}
										}}
										onBlur={() => {
											if (skipRenameBlurRef.current) {
												skipRenameBlurRef.current = false;
												return;
											}
											void commitRename();
										}}
									/>
								) : (
									<button
										type="button"
										className={item.id === state.sessionId ? "is-on" : undefined}
										disabled={status !== "idle"}
										onClick={() => void openSession(item.id)}
									>
										<span>{item.label}</span>
										{item.hint ? <em>{item.hint}</em> : null}
									</button>
								)}
							</li>
						))}
					</ul>
				)}
			</section>
			<button
				type="button"
				className={`desk-settings-btn ${view === "files" ? "is-on" : ""}`}
				aria-label="Files"
				onClick={() => setView((current) => (current === "files" ? "chat" : "files"))}
			>
				<FileIcon size={16} weight="regular" />
				<span>Files</span>
			</button>
			<button
				type="button"
				className={`desk-settings-btn ${view === "memory" ? "is-on" : ""}`}
				aria-label="Memory"
				onClick={() => setView((current) => (current === "memory" ? "chat" : "memory"))}
			>
				<BrainIcon size={16} weight="regular" />
				<span>Memory</span>
			</button>
			<button
				type="button"
				className={`desk-settings-btn ${view === "skills" ? "is-on" : ""}`}
				aria-label="Skills"
				onClick={() => {
					setView((current) => (current === "skills" ? "chat" : "skills"));
					setSkillQuery("");
				}}
			>
				<PuzzlePieceIcon size={16} weight="regular" />
				<span>Skills</span>
			</button>
			<button
				type="button"
				className={`desk-settings-btn ${view === "integrations" ? "is-on" : ""}`}
				aria-label="Integrations"
				onClick={() => setView((current) => (current === "integrations" ? "chat" : "integrations"))}
			>
				<PlugsIcon size={16} weight="regular" />
				<span>Integrations</span>
			</button>
			<button
				type="button"
				className={`desk-settings-btn ${view === "settings" ? "is-on" : ""}`}
				aria-label="Settings"
				onClick={() => setView((current) => (current === "settings" ? "chat" : "settings"))}
			>
				<GearIcon size={16} weight="regular" />
				<span>Settings</span>
			</button>
		</aside>
	);
}
