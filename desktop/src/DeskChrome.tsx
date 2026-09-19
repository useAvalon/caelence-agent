import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import {
	type BridgeClient,
	type DesktopState,
	deleteUploads,
	openLocalFile,
	type PickerItem,
} from "./api";
import { DeskComposer } from "./DeskComposer";
import { DeskSidebar } from "./DeskSidebar";
import {
	isUploadEditPending,
	type MainView,
	mainViewTitle,
	type PendingApproval,
	type ShowNotice,
	type ThemeChoice,
} from "./desk-types";
import { FilesPanel, homePath } from "./FilesPanel";
import { FloatNotice } from "./FloatNotice";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { SessionsPanel } from "./SessionsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SkillsPanel } from "./SkillsPanel";
import { previewInput } from "./stream";
import { DeskTranscript } from "./TranscriptViews";
import { groupTranscriptLines, type TranscriptBlock } from "./thought";
import type { DeskReady } from "./useDesktopApp";

export function DeskSidePanel(
	props: Readonly<{
		view: MainView;
		bridge: BridgeClient | null;
		theme: ThemeChoice;
		skillQuery: string;
		uploads: Array<{ name: string; rel: string; sourcePath?: string }>;
		onTheme: (theme: ThemeChoice) => void;
		onSaved: (state: DesktopState) => void;
		onNotice: ShowNotice;
		onSkillQuery: (value: string) => void;
		onOpenFile: (path: string, reveal: boolean) => void;
		onDeleteFiles: (rels: readonly string[]) => void | Promise<void>;
		sessions: PickerItem[];
		sessionBusy: boolean;
		onOpenSession: (id: string) => void;
		onDeleteSessions: (ids: readonly string[]) => void | Promise<void>;
	}>,
): React.ReactElement | null {
	if (!props.bridge) return null;
	if (props.view === "settings") {
		return (
			<SettingsPanel
				bridge={props.bridge}
				theme={props.theme}
				onTheme={props.onTheme}
				onSaved={props.onSaved}
				onNotice={props.onNotice}
			/>
		);
	}
	if (props.view === "integrations") {
		return <IntegrationsPanel bridge={props.bridge} onNotice={props.onNotice} />;
	}
	if (props.view === "skills") {
		return (
			<SkillsPanel
				bridge={props.bridge}
				query={props.skillQuery}
				onQuery={props.onSkillQuery}
				onNotice={props.onNotice}
			/>
		);
	}
	if (props.view === "files") {
		return (
			<FilesPanel items={props.uploads} onOpen={props.onOpenFile} onDelete={props.onDeleteFiles} />
		);
	}
	if (props.view === "memory") {
		return <MemoryPanel bridge={props.bridge} onNotice={props.onNotice} />;
	}
	if (props.view === "sessions") {
		return (
			<SessionsPanel
				sessions={props.sessions}
				busy={props.sessionBusy}
				onOpen={props.onOpenSession}
				onDelete={props.onDeleteSessions}
			/>
		);
	}
	return null;
}

export function DesktopChrome(props: Readonly<{ desk: DeskReady }>): React.ReactElement {
	const desk = props.desk;
	const { lines, status, sideOpen, pending } = desk;
	const approvalPreview = pending ? previewInput(pending.input) : "";
	const turnRunning = status === "running" || status === "approval";
	const transcriptBlocks = groupTranscriptLines(lines);
	const lastLine = lines.at(-1);
	const thoughtPending = turnRunning && (!lastLine || lastLine.type === "user");
	const warmupSeed = lastLine?.type === "user" ? lastLine.userTurnIndex : 0;

	return (
		<div className={`desk${sideOpen ? "" : " is-side-off"}`}>
			<DeskSidebar desk={desk} />
			<DeskMain
				desk={desk}
				approvalPreview={approvalPreview}
				turnRunning={turnRunning}
				transcriptBlocks={transcriptBlocks}
				thoughtPending={thoughtPending}
				warmupSeed={warmupSeed}
			/>
		</div>
	);
}

export function DeskApproval(
	props: Readonly<{ desk: DeskReady; approvalPreview: string }>,
): React.ReactElement | null {
	const pending = props.desk.pending;
	if (!pending) return null;
	if (isUploadEditPending(pending)) {
		return (
			<DeskUploadApproval
				pending={pending}
				approvalPreview={props.approvalPreview}
				onDecide={props.desk.decide}
			/>
		);
	}
	return (
		<DeskToolApproval
			pending={pending}
			approvalPreview={props.approvalPreview}
			onDecide={props.desk.decide}
		/>
	);
}

export function DeskUploadApproval(
	props: Readonly<{
		pending: PendingApproval;
		approvalPreview: string;
		onDecide: DeskReady["decide"];
	}>,
): React.ReactElement {
	const fileName =
		typeof props.pending.input.fileName === "string" ? props.pending.input.fileName : "File";
	const copyPath =
		typeof props.pending.input.copyPath === "string"
			? props.pending.input.copyPath
			: props.approvalPreview;
	const originalPath =
		typeof props.pending.input.originalPath === "string"
			? homePath(props.pending.input.originalPath)
			: "";
	return (
		<section className="desk-approve" aria-label="Approval needed">
			<p>Edit this file where?</p>
			<pre className="cel-code">
				{fileName}
				{"\n"}Copy: {copyPath}
				{originalPath ? `\nOriginal: ${originalPath}` : ""}
			</pre>
			<div className="desk-approve-actions">
				<button
					type="button"
					className="cel-btn cel-btn--secondary cel-btn--compact"
					onClick={() => void props.onDecide("copy")}
				>
					Copy
				</button>
				<button
					type="button"
					className="cel-btn cel-btn--secondary cel-btn--compact"
					onClick={() => void props.onDecide("original")}
				>
					Original
				</button>
				<button
					type="button"
					className="cel-btn cel-btn--tertiary cel-btn--compact"
					onClick={() => void props.onDecide("no")}
				>
					Cancel
				</button>
			</div>
		</section>
	);
}

export function DeskToolApproval(
	props: Readonly<{
		pending: PendingApproval;
		approvalPreview: string;
		onDecide: DeskReady["decide"];
	}>,
): React.ReactElement {
	return (
		<section className="desk-approve" aria-label="Approval needed">
			<p>Approval needed · {props.pending.toolName}</p>
			<pre className="cel-code">{props.approvalPreview}</pre>
			<div className="desk-approve-actions">
				<button
					type="button"
					className="cel-btn cel-btn--secondary cel-btn--compact"
					onClick={() => void props.onDecide("yes")}
				>
					Approve
				</button>
				<button
					type="button"
					className="cel-btn cel-btn--secondary cel-btn--compact"
					onClick={() => void props.onDecide("no")}
				>
					Deny
				</button>
				<button
					type="button"
					className="cel-btn cel-btn--tertiary cel-btn--compact"
					onClick={() => void props.onDecide("always")}
				>
					Always this session
				</button>
			</div>
		</section>
	);
}

export function DeskSessionMenu(props: Readonly<{ desk: DeskReady }>): React.ReactElement | null {
	const menu = props.desk.sessionMenu;
	if (!menu) return null;
	return (
		<div
			ref={props.desk.sessionMenuRef}
			className="desk-menu cel-float"
			role="menu"
			aria-label="Chat"
			style={{ left: menu.x, top: menu.y }}
		>
			<button
				type="button"
				role="menuitem"
				onClick={() => {
					props.desk.setRenameDraft(menu.label);
					props.desk.setRenamingId(menu.id);
					props.desk.setSessionMenu(null);
				}}
			>
				<PencilSimpleIcon size={16} weight="regular" />
				Rename
			</button>
			<button
				type="button"
				role="menuitem"
				className="is-danger"
				onClick={() => void props.desk.removeChat(menu.id)}
			>
				<TrashIcon size={16} weight="regular" />
				Delete
			</button>
		</div>
	);
}

export function DeskMain(
	props: Readonly<{
		desk: DeskReady;
		approvalPreview: string;
		turnRunning: boolean;
		transcriptBlocks: TranscriptBlock[];
		thoughtPending: boolean;
		warmupSeed: number;
	}>,
): React.ReactElement {
	const { desk } = props;
	const { view, fileDrag, pending, notice, sessionMenu, dismissNotice } = desk;
	return (
		<>
			<section
				className={`desk-main${fileDrag && view === "chat" ? " is-file-drag" : ""}`}
				aria-label="Chat"
				onDragEnter={desk.onFileDragEnter}
				onDragOver={desk.onFileDragOver}
				onDragLeave={desk.onFileDragLeave}
				onDrop={desk.onFileDrop}
			>
				<header className="desk-bar">
					<div className="desk-id">
						<h1>{mainViewTitle(view)}</h1>
						{view === "chat" && desk.state.spend ? <p>{desk.state.spend}</p> : null}
					</div>
				</header>
				<div className="desk-stage">
					{view !== "chat" ? (
						<DeskSidePanel
							view={view}
							bridge={desk.bridge}
							theme={desk.theme}
							skillQuery={desk.skillQuery}
							uploads={desk.state.uploads ?? []}
							onTheme={desk.setTheme}
							onSaved={(next) => desk.setState(next)}
							onNotice={desk.showNotice}
							onSkillQuery={desk.setSkillQuery}
							onOpenFile={(path, reveal) => {
								void openLocalFile(path, reveal, desk.bridge).catch((err: unknown) => {
									desk.noticeError(err);
								});
							}}
							onDeleteFiles={(rels) => {
								if (!desk.bridge) return;
								return deleteUploads(desk.bridge, rels)
									.then((result) => {
										desk.setState(result.state);
										desk.showNotice(rels.length > 1 ? `Deleted ${rels.length}` : "Deleted");
									})
									.catch((err: unknown) => {
										desk.noticeError(err);
									});
							}}
							sessions={desk.sessions}
							sessionBusy={desk.status !== "idle"}
							onOpenSession={(id) => void desk.openSession(id)}
							onDeleteSessions={(ids) => desk.removeChats(ids)}
						/>
					) : (
						<DeskTranscript
							desk={desk}
							turnRunning={props.turnRunning}
							transcriptBlocks={props.transcriptBlocks}
							thoughtPending={props.thoughtPending}
							warmupSeed={props.warmupSeed}
						/>
					)}
					{view === "chat" && pending ? (
						<DeskApproval desk={desk} approvalPreview={props.approvalPreview} />
					) : null}
					{view === "chat" ? <DeskComposer desk={desk} /> : null}
				</div>
				{notice ? (
					<div className="desk-notice-host">
						<FloatNotice
							key={notice.id}
							text={notice.text}
							kind={notice.kind}
							onDismiss={dismissNotice}
						/>
					</div>
				) : null}
			</section>
			{sessionMenu ? <DeskSessionMenu desk={desk} /> : null}
		</>
	);
}
