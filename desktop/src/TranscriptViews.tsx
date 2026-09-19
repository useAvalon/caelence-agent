import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useEffect, useState } from "react";
import {
	type BridgeClient,
	embedPreview,
	openExternal,
	openLocalFile,
	type PublicIntegration,
} from "./api";
import { BubbleClip } from "./BubbleClip";
import { AttachmentThumbs } from "./ComposerAttach";
import { PipelineTrack } from "./PipelineTrack";
import { PlatformPane } from "./PlatformPane";
import { pipelineProgress } from "./pipeline";
import { formatPlatformOutput, isPlatformTool } from "./platform";
import { ReplySources } from "./ReplySources";
import { canvaViewUrl, looksLikeWebUrl, splitRichText, webHref } from "./rich-text";
import { ShimmerPhrase } from "./ShimmerPhrase";
import type { StreamLine } from "./stream";
import {
	type FoldEntry,
	liveStatusPhrases,
	type ToolLine,
	type TranscriptBlock,
	thoughtSummary,
	thoughtTools,
} from "./thought";
import { eventCountSuffix } from "./tool-label";
import type { DeskReady } from "./useDesktopApp";
import { userBubbleContent } from "./user-display";

const SILENT_CAPTIONS = "data:text/vtt,WEBVTT";

export function richPartKey(part: ReturnType<typeof splitRichText>[number]): string {
	if (part.type === "text") return `text:${part.text}`;
	if (part.type === "link") return `link:${part.href}:${part.label}`;
	if (part.type === "file") return `file:${part.path}:${part.label}`;
	return `image:${part.src}:${part.alt}`;
}
export function ThoughtFold(
	props: Readonly<{
		entries: FoldEntry[];
		live: boolean;
		warmupSeed?: number;
	}>,
): React.ReactElement {
	const { entries, live } = props;
	const tools = thoughtTools(entries);
	const summary = thoughtSummary(tools, live, {
		warmup: entries.length === 0,
		seed: props.warmupSeed ?? 0,
	});
	const phrases = live ? liveStatusPhrases(tools, entries.length === 0) : [summary.headline];
	const pipe = live ? pipelineProgress(tools) : undefined;
	const hasBody = entries.some((entry) =>
		entry.type === "note" ? entry.text.trim().length > 0 : true,
	);
	const headline = (
		<span className="desk-thought__copy">
			<span className="desk-thought__headline">
				<ShimmerPhrase phrases={phrases} live={live} tone={pipe ? "pipe" : undefined} />
			</span>
			{pipe ? <PipelineTrack steps={pipe.steps} /> : null}
		</span>
	);
	if (!hasBody) {
		return (
			<p className={`desk-thought desk-thought--plain${pipe ? " is-pipe" : ""}`}>{headline}</p>
		);
	}
	return (
		<details className={`desk-thought${pipe ? " is-pipe" : ""}`}>
			<summary>{headline}</summary>
			<div className="desk-thought__body">
				{entries.map((entry) => {
					if (entry.type === "note") {
						const text = entry.text.trim();
						if (!text) return null;
						return (
							<p key={`note-${text}`} className="desk-thought__reasoning">
								{text}
							</p>
						);
					}
					return <ToolEventRow key={entry.tool.key} line={entry.tool} />;
				})}
			</div>
		</details>
	);
}

export function ToolEventRow(props: Readonly<{ line: ToolLine }>): React.ReactElement {
	const { line } = props;
	const count = eventCountSuffix(line.count);
	return (
		<article className={`desk-line desk-line--event is-${line.status}`}>
			<p>
				{line.status === "running" ? (
					<span className="desk-event__spin" aria-hidden="true" />
				) : (
					<GearIcon size={16} weight="regular" aria-hidden="true" />
				)}
				<span>
					{line.label}
					{count}
				</span>
			</p>
			{line.status === "fail" && line.error ? (
				<p className="desk-event__err">{line.error}</p>
			) : null}
		</article>
	);
}

export function UserTranscriptLine(
	props: Readonly<{
		line: Extract<StreamLine, { type: "user" }>;
		editing?: string | null;
		onStartEdit?: () => void;
		onEditChange?: (text: string) => void;
		onEditSave?: () => void;
		onEditCancel?: () => void;
	}>,
): React.ReactElement {
	const editing = props.editing != null;
	const shown = userBubbleContent(props.line.text, props.line.attachments);
	return (
		<article className={`desk-line desk-line--user${editing ? " is-editing" : ""}`}>
			<p className="desk-line__who">
				{!editing && props.onStartEdit ? (
					<button
						type="button"
						className="cel-btn cel-btn--quiet cel-btn--compact desk-line__edit-btn"
						onClick={props.onStartEdit}
					>
						<PencilSimpleIcon size={16} weight="regular" />
						Edit
					</button>
				) : null}
				<span>You</span>
			</p>
			<div className="desk-line__body">
				{editing ? (
					<>
						<textarea
							className="cel-input desk-compose-input"
							rows={3}
							value={props.editing ?? ""}
							aria-label="Edit message"
							onChange={(event) => props.onEditChange?.(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									props.onEditSave?.();
								}
								if (event.key === "Escape") {
									event.preventDefault();
									props.onEditCancel?.();
								}
							}}
						/>
						<div className="desk-line__edit-actions">
							<button
								type="button"
								className="cel-btn cel-btn--secondary cel-btn--compact"
								onClick={props.onEditSave}
							>
								Save
							</button>
							<button
								type="button"
								className="cel-btn cel-btn--quiet cel-btn--compact"
								onClick={props.onEditCancel}
							>
								Cancel
							</button>
						</div>
					</>
				) : (
					<>
						<AttachmentThumbs items={shown.attachments} variant="chat" />
						{shown.text ? (
							<BubbleClip text={shown.text}>
								<p>{shown.text}</p>
							</BubbleClip>
						) : null}
					</>
				)}
			</div>
		</article>
	);
}

export function TranscriptLine(
	props: Readonly<{
		line: StreamLine;
		lines: StreamLine[];
		bridge: BridgeClient | null;
		integrations: PublicIntegration[];
		editing?: string | null;
		onStartEdit?: () => void;
		onEditChange?: (text: string) => void;
		onEditSave?: () => void;
		onEditCancel?: () => void;
		onOpenUrl?: (url: string) => void;
		onOpenFile?: (path: string, reveal: boolean) => void;
	}>,
): React.ReactElement {
	const { line, bridge, onOpenUrl, onOpenFile } = props;
	if (line.type === "user") {
		return (
			<UserTranscriptLine
				line={line}
				editing={props.editing}
				onStartEdit={props.onStartEdit}
				onEditChange={props.onEditChange}
				onEditSave={props.onEditSave}
				onEditCancel={props.onEditCancel}
			/>
		);
	}
	if (line.type === "assistant") {
		return (
			<article className="desk-line desk-line--assistant">
				<p className="desk-line__who">Agent</p>
				<div className="desk-line__body">
					<RichBody
						text={line.text}
						bridge={bridge}
						onOpenUrl={onOpenUrl}
						onOpenFile={onOpenFile}
					/>
					<ReplySources
						lines={props.lines}
						assistantKey={line.key}
						bridge={bridge}
						onOpenUrl={onOpenUrl}
						onOpenFile={onOpenFile}
					/>
				</div>
			</article>
		);
	}
	if (line.type === "tool") {
		return (
			<ToolTranscriptLine
				line={line}
				bridge={bridge}
				integrations={props.integrations}
				onOpenUrl={onOpenUrl}
				onOpenFile={onOpenFile}
			/>
		);
	}
	if (line.type === "error") {
		return (
			<article className="desk-line desk-line--error">
				<p>{line.text}</p>
			</article>
		);
	}
	if (line.type === "media") {
		return <MediaTranscriptLine line={line} />;
	}
	return (
		<article className="desk-line desk-line--system">
			<p>{line.text}</p>
		</article>
	);
}

export function ToolTranscriptLine(
	props: Readonly<{
		line: Extract<StreamLine, { type: "tool" }>;
		bridge: BridgeClient | null;
		integrations: PublicIntegration[];
		onOpenUrl?: (url: string) => void;
		onOpenFile?: (path: string, reveal: boolean) => void;
	}>,
): React.ReactElement {
	const { line, bridge, onOpenUrl, onOpenFile } = props;
	if (isPlatformTool(line.name)) {
		const body = formatPlatformOutput(line.output ?? "");
		return (
			<PlatformPane line={line} integrations={props.integrations}>
				{body ? (
					<RichBody text={body} bridge={bridge} onOpenUrl={onOpenUrl} onOpenFile={onOpenFile} />
				) : null}
			</PlatformPane>
		);
	}
	const count = eventCountSuffix(line.count);
	return (
		<article className={`desk-line desk-line--event is-${line.status}`}>
			<p>
				{line.status === "running" ? (
					<span className="desk-event__spin" aria-hidden="true" />
				) : (
					<GearIcon size={16} weight="regular" aria-hidden="true" />
				)}
				<span>
					{line.label}
					{count}
				</span>
			</p>
			{line.status === "fail" && line.error ? (
				<p className="desk-event__err">{line.error}</p>
			) : null}
		</article>
	);
}

export function MediaTranscriptLine(
	props: Readonly<{ line: Extract<StreamLine, { type: "media" }> }>,
): React.ReactElement {
	const { line } = props;
	const preview =
		line.kind === "video" ? (
			<video className="desk-preview desk-preview--img" controls src={line.src}>
				<track kind="captions" srcLang="en" label="Captions" src={SILENT_CAPTIONS} />
			</video>
		) : (
			<img className="desk-preview desk-preview--img" src={line.src} alt={line.caption} />
		);
	return (
		<article className="desk-line desk-line--assistant">
			<p className="desk-line__who">Agent</p>
			<div className="desk-line__body">
				{preview}
				<p className="desk-line__caption">{line.caption}</p>
			</div>
		</article>
	);
}

export function RichBody(
	props: Readonly<{
		text: string;
		bridge: BridgeClient | null;
		onOpenUrl?: (url: string) => void;
		onOpenFile?: (path: string, reveal: boolean) => void;
	}>,
): React.ReactElement {
	const parts = splitRichText(props.text);
	return (
		<div className="desk-rich">
			{parts.map((part, index) => {
				if (part.type === "text") {
					const next = parts.at(index + 1);
					if (next?.type === "image" && /^\s*Preview:?\s*$/i.test(part.text)) return null;
					return <span key={richPartKey(part)}>{part.text}</span>;
				}
				if (part.type === "file") {
					return (
						<FileLink
							key={richPartKey(part)}
							path={part.path}
							label={part.label}
							onOpenFile={props.onOpenFile}
							onOpenUrl={props.onOpenUrl}
						/>
					);
				}
				if (part.type === "image") {
					const viewHref = [...parts]
						.reverse()
						.find(
							(item): item is Extract<typeof item, { type: "link" }> =>
								item.type === "link" && item.href.includes("canva.com/d/"),
						)?.href;
					return (
						<PreviewFrame
							key={richPartKey(part)}
							src={part.src}
							title={part.alt}
							viewHref={viewHref}
							bridge={props.bridge}
							onOpenUrl={props.onOpenUrl}
						/>
					);
				}
				return (
					<ExternalLink
						key={richPartKey(part)}
						href={part.href}
						label={part.label}
						onOpenUrl={props.onOpenUrl}
					/>
				);
			})}
		</div>
	);
}

export function FileLink(
	props: Readonly<{
		path: string;
		label: string;
		onOpenFile?: (path: string, reveal: boolean) => void;
		onOpenUrl?: (url: string) => void;
	}>,
): React.ReactElement {
	if (looksLikeWebUrl(props.path)) {
		return (
			<ExternalLink href={webHref(props.path)} label={props.label} onOpenUrl={props.onOpenUrl} />
		);
	}
	return (
		<span className="desk-file">
			<button
				type="button"
				className="desk-link"
				onClick={() => props.onOpenFile?.(props.path, false)}
			>
				{props.label}
			</button>
			<button
				type="button"
				className="desk-link desk-link--icon"
				aria-label={`Show ${props.label} in folder`}
				onClick={() => props.onOpenFile?.(props.path, true)}
			>
				<FolderSimpleIcon size={16} weight="regular" aria-hidden="true" />
			</button>
		</span>
	);
}

export function ExternalLink(
	props: Readonly<{
		href: string;
		label: string;
		onOpenUrl?: (url: string) => void;
	}>,
): React.ReactElement {
	return (
		<button type="button" className="desk-link" onClick={() => props.onOpenUrl?.(props.href)}>
			<span>{props.label}</span>
			<ArrowUpRightIcon size={16} weight="regular" aria-hidden="true" />
		</button>
	);
}

export function PreviewFrame(
	props: Readonly<{
		src: string;
		title: string;
		viewHref?: string;
		bridge: BridgeClient | null;
		onOpenUrl?: (url: string) => void;
	}>,
): React.ReactElement {
	const [blobSrc, setBlobSrc] = useState<string | null>(null);
	const [mode, setMode] = useState<"load" | "frame" | "expired">("load");
	const openHref = props.viewHref ?? canvaViewUrl(props.src) ?? props.src;

	useEffect(() => {
		let objectUrl: string | undefined;
		let cancelled = false;
		setMode("load");
		setBlobSrc(null);
		void (async () => {
			try {
				if (!props.bridge) {
					if (!cancelled) setMode("expired");
					return;
				}
				const blob = await embedPreview(props.bridge, props.src);
				if (cancelled) return;
				objectUrl = URL.createObjectURL(blob);
				if (cancelled) {
					URL.revokeObjectURL(objectUrl);
					return;
				}
				setBlobSrc(objectUrl);
				setMode("frame");
			} catch {
				if (!cancelled) setMode("expired");
			}
		})();
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [props.bridge, props.src]);

	if (mode === "expired") {
		return (
			<div className="desk-preview desk-preview--empty">
				<p>Preview expired</p>
				<p>The thumbnail link is no longer valid.</p>
				<button
					type="button"
					className="cel-btn cel-btn--tertiary cel-btn--compact"
					onClick={() => props.onOpenUrl?.(openHref)}
				>
					Open in Canva
				</button>
			</div>
		);
	}
	if (mode === "frame" && blobSrc) {
		return <img className="desk-preview desk-preview--img" src={blobSrc} alt={props.title} />;
	}
	return (
		<div className="desk-preview desk-preview--empty" aria-busy="true">
			<span className="cel-chip cel-chip--run">
				<span className="cel-chip__spin" aria-hidden="true" />
				{"Preview"}
			</span>
		</div>
	);
}

export function DeskTranscript(
	props: Readonly<{
		desk: DeskReady;
		turnRunning: boolean;
		transcriptBlocks: TranscriptBlock[];
		thoughtPending: boolean;
		warmupSeed: number;
	}>,
): React.ReactElement {
	const empty = props.desk.lines.length === 0 && !props.thoughtPending;
	return (
		<div className="desk-transcript" ref={props.desk.transcriptRef}>
			{empty ? (
				<p className="desk-hint">Type a message, drop files, or / for commands</p>
			) : (
				<DeskTranscriptBlocks
					desk={props.desk}
					turnRunning={props.turnRunning}
					transcriptBlocks={props.transcriptBlocks}
					thoughtPending={props.thoughtPending}
					warmupSeed={props.warmupSeed}
				/>
			)}
		</div>
	);
}

export function DeskTranscriptBlocks(
	props: Readonly<{
		desk: DeskReady;
		turnRunning: boolean;
		transcriptBlocks: TranscriptBlock[];
		thoughtPending: boolean;
		warmupSeed: number;
	}>,
): React.ReactElement {
	return (
		<>
			{props.transcriptBlocks.map((block, index) => (
				<DeskTranscriptBlock
					key={transcriptBlockKey(block, index)}
					desk={props.desk}
					block={block}
					index={index}
					turnRunning={props.turnRunning}
				/>
			))}
			{props.thoughtPending ? (
				<ThoughtFold key="thinking" entries={[]} live warmupSeed={props.warmupSeed} />
			) : null}
		</>
	);
}

export function transcriptBlockKey(block: TranscriptBlock, index: number): string {
	if (block.type === "thought") return thoughtTools(block.entries)[0]?.key ?? `thought-${index}`;
	return block.line.key;
}

export function DeskTranscriptBlock(
	props: Readonly<{
		desk: DeskReady;
		block: TranscriptBlock;
		index: number;
		turnRunning: boolean;
	}>,
): React.ReactElement {
	const { desk, block, index, turnRunning } = props;
	if (block.type === "thought") {
		return (
			<ThoughtFold
				key={thoughtTools(block.entries)[0]?.key ?? `thought-${index}`}
				entries={block.entries}
				live={turnRunning && block.live}
			/>
		);
	}
	const line = block.line;
	const editing =
		line.type === "user" && desk.editingUser?.index === line.userTurnIndex
			? desk.editingUser.text
			: null;
	return (
		<TranscriptLine
			key={line.key}
			line={line}
			lines={desk.lines}
			bridge={desk.bridge}
			integrations={desk.integrations}
			editing={editing}
			onStartEdit={
				line.type === "user"
					? () => {
							const shown = userBubbleContent(line.text, line.attachments);
							desk.setEditingUser({
								index: line.userTurnIndex,
								text: shown.text,
								suffix: shown.suffix,
							});
						}
					: undefined
			}
			onEditChange={(text) =>
				desk.setEditingUser((current) => (current ? { ...current, text } : current))
			}
			onEditSave={() => void desk.commitEdit()}
			onEditCancel={() => desk.setEditingUser(null)}
			onOpenUrl={(url) => {
				void openExternal(url, desk.bridge).catch((err: unknown) => {
					desk.noticeError(err);
				});
			}}
			onOpenFile={(path, reveal) => {
				void openLocalFile(path, reveal, desk.bridge).catch((err: unknown) => {
					desk.noticeError(err);
				});
			}}
		/>
	);
}
