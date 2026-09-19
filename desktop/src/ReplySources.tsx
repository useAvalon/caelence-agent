import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type BridgeClient, fileBytesUrl, readFilePreview } from "./api";
import { renderPreviewHtml, rewritePreviewAssets } from "./preview-render";
import { type ReplySource, replySourcesForAssistant } from "./reply-sources";
import { looksLikeWebUrl, webHref } from "./rich-text";
import type { StreamLine } from "./stream";

export function ReplySources(
	props: Readonly<{
		lines: StreamLine[];
		assistantKey: string;
		bridge: BridgeClient | null;
		onOpenUrl?: (url: string) => void;
		onOpenFile?: (path: string, reveal: boolean) => void;
	}>,
): ReactElement | null {
	const sources = replySourcesForAssistant(props.lines, props.assistantKey);
	const [active, setActive] = useState<ReplySource | null>(null);
	if (sources.length === 0) return null;
	return (
		<>
			<details className="desk-sources">
				<summary>Sources</summary>
				<ul>
					{sources.map((source) => (
						<li key={`${source.kind}:${source.path}`}>
							<SourceItem
								source={source}
								onOpenUrl={props.onOpenUrl}
								onOpenFile={props.onOpenFile}
								onPreview={setActive}
							/>
						</li>
					))}
				</ul>
			</details>
			{active ? (
				<SourcePreviewModal
					source={active}
					bridge={props.bridge}
					onClose={() => setActive(null)}
					onOpenFile={props.onOpenFile}
					onOpenUrl={props.onOpenUrl}
				/>
			) : null}
		</>
	);
}

function SourceItem(
	props: Readonly<{
		source: ReplySource;
		onOpenUrl?: (url: string) => void;
		onOpenFile?: (path: string, reveal: boolean) => void;
		onPreview: (source: ReplySource) => void;
	}>,
): ReactElement {
	const { source } = props;
	if (source.kind === "web" || looksLikeWebUrl(source.path)) {
		const href = webHref(source.path);
		return (
			<button type="button" className="desk-sources__name" onClick={() => props.onOpenUrl?.(href)}>
				{source.label}
			</button>
		);
	}
	return (
		<div className="desk-sources__file">
			<button type="button" className="desk-sources__name" onClick={() => props.onPreview(source)}>
				{source.label}
			</button>
			<button
				type="button"
				className="desk-link desk-link--icon"
				aria-label={`Show ${source.label} in folder`}
				onClick={() => props.onOpenFile?.(source.path, true)}
			>
				<FolderSimpleIcon size={14} weight="regular" aria-hidden="true" />
			</button>
		</div>
	);
}

function SourcePreviewModal(
	props: Readonly<{
		source: ReplySource;
		bridge: BridgeClient | null;
		onClose: () => void;
		onOpenFile?: (path: string, reveal: boolean) => void;
		onOpenUrl?: (url: string) => void;
	}>,
): ReactElement {
	const onCloseRef = useRef(props.onClose);
	onCloseRef.current = props.onClose;
	const { source, onClose } = props;

	useEffect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onCloseRef.current();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.body.style.overflow = previous;
			document.removeEventListener("keydown", onKey);
		};
	}, []);

	return createPortal(
		<div className="desk-source-modal-root">
			<button
				type="button"
				className="desk-source-modal__scrim"
				aria-label="Close preview"
				onClick={onClose}
			/>
			<div
				className="desk-source-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="desk-source-modal-title"
			>
				<header className="desk-source-modal__head">
					<h2 id="desk-source-modal-title">{source.label}</h2>
					<button
						type="button"
						className="desk-link desk-link--icon"
						aria-label={`Show ${source.label} in folder`}
						onClick={() => props.onOpenFile?.(source.path, true)}
					>
						<FolderSimpleIcon size={16} weight="regular" />
					</button>
					<button
						type="button"
						className="desk-source-modal__close"
						aria-label="Close preview"
						onClick={onClose}
					>
						<XIcon size={16} weight="regular" />
					</button>
				</header>
				<div className="desk-source-modal__body">
					<FilePreview path={source.path} bridge={props.bridge} onOpenUrl={props.onOpenUrl} />
				</div>
			</div>
		</div>,
		document.body,
	);
}

function FilePreview(
	props: Readonly<{
		path: string;
		bridge: BridgeClient | null;
		onOpenUrl?: (url: string) => void;
	}>,
): ReactElement {
	const [html, setHtml] = useState<string | null>(null);
	const [imageSrc, setImageSrc] = useState<string | null>(null);
	const [text, setText] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [truncated, setTruncated] = useState(false);

	useEffect(() => {
		const bridge = props.bridge;
		if (!bridge) {
			setError("Preview needs the desktop window.");
			return;
		}
		setHtml(null);
		setImageSrc(null);
		setText(null);
		setError(null);
		setTruncated(false);
		let cancelled = false;
		void (async () => {
			try {
				const result = await readFilePreview(bridge, props.path);
				if (cancelled) return;
				setTruncated(result.truncated === true);
				if (result.kind === "image") {
					setImageSrc(fileBytesUrl(bridge, result.path));
					return;
				}
				const raw = result.text ?? "";
				if (result.kind === "markdown" || result.kind === "html") {
					const rendered = rewritePreviewAssets(
						renderPreviewHtml(raw, result.kind),
						result.path,
						(rel) => fileBytesUrl(bridge, rel),
					);
					setHtml(rendered);
					return;
				}
				setText(raw);
			} catch (err) {
				if (!cancelled)
					setError(err instanceof Error ? err.message : "Could not preview the file.");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [props.bridge, props.path]);

	if (error) return <p className="desk-sources__empty">{error}</p>;
	if (imageSrc) {
		return <img className="desk-source-modal__img" src={imageSrc} alt="" />;
	}
	if (html != null) {
		return (
			<>
				{truncated ? (
					<p className="desk-sources__empty">Showing the first part of the file.</p>
				) : null}
				<RenderedHtml html={html} onOpenUrl={props.onOpenUrl} />
			</>
		);
	}
	if (text != null) {
		return (
			<>
				{truncated ? (
					<p className="desk-sources__empty">Showing the first part of the file.</p>
				) : null}
				<pre className="cel-code desk-sources__preview">{text}</pre>
			</>
		);
	}
	return <p className="desk-sources__empty">Loading</p>;
}

function RenderedHtml(
	props: Readonly<{ html: string; onOpenUrl?: (url: string) => void }>,
): ReactElement {
	const rootRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const onClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof HTMLAnchorElement)) return;
			const href = target.getAttribute("href");
			if (!href || href.startsWith("#")) return;
			if (!looksLikeWebUrl(href) && !/^https?:\/\//i.test(href)) return;
			event.preventDefault();
			props.onOpenUrl?.(webHref(href));
		};
		root.addEventListener("click", onClick);
		return () => root.removeEventListener("click", onClick);
	}, [props.html, props.onOpenUrl]);
	return (
		<div
			ref={rootRef}
			className="desk-md"
			// Local project files only. Scripts and handlers are stripped first.
			// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized local preview
			dangerouslySetInnerHTML={{ __html: props.html }}
		/>
	);
}
