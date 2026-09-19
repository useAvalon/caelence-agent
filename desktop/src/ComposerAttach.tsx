import { FileIcon as FileGlyph } from "@phosphor-icons/react/dist/csr/File";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { AttachmentPreview, ComposerFileKind } from "./composer-files.ts";
import { fileExtension } from "./composer-files.ts";

export function AttachmentThumbs(
	props: Readonly<{
		items: Array<AttachmentPreview & { id?: string }>;
		onRemove?: (index: number) => void;
		variant?: "thumb" | "chat";
	}>,
): React.ReactElement | null {
	if (props.items.length === 0) return null;
	if (props.variant === "chat") {
		return (
			<ul className="desk-attach-previews" aria-label="Attached files">
				{props.items.map((item, index) => (
					<li key={item.id ?? `${item.name}-${index}`} className="desk-attach-preview">
						<ChatPreview name={item.name} />
					</li>
				))}
			</ul>
		);
	}
	return (
		<ul className="desk-thumbs" aria-label="Attached files">
			{props.items.map((item, index) => (
				<li key={item.id ?? `${item.name}-${index}`} className="desk-thumb" title={item.name}>
					<ThumbPreview name={item.name} kind={item.kind} previewUrl={item.previewUrl} />
					{props.onRemove ? (
						<button
							type="button"
							className="desk-thumb__remove"
							aria-label={`Remove ${item.name}`}
							onClick={() => props.onRemove?.(index)}
						>
							<XIcon size={12} weight="bold" />
						</button>
					) : null}
				</li>
			))}
		</ul>
	);
}

function ChatPreview(props: Readonly<{ name: string }>): React.ReactElement {
	return (
		<span className="desk-attach-file">
			<FileGlyph size={16} weight="regular" aria-hidden="true" />
			<em>{fileExtension(props.name)}</em>
			<span>{props.name}</span>
		</span>
	);
}

function ThumbPreview(
	props: Readonly<{
		name: string;
		kind: ComposerFileKind;
		previewUrl?: string;
	}>,
): React.ReactElement {
	if (props.kind === "image" && props.previewUrl) {
		return <img className="desk-thumb__media" src={props.previewUrl} alt={props.name} />;
	}
	if (props.kind === "video" && props.previewUrl) {
		return (
			<video
				className="desk-thumb__media"
				src={props.previewUrl}
				muted
				playsInline
				preload="metadata"
				aria-label={props.name}
			>
				<track kind="captions" srcLang="en" label="Captions" src="data:text/vtt,WEBVTT" />
			</video>
		);
	}
	return (
		<span className="desk-thumb__file">
			<FileGlyph size={16} weight="regular" aria-hidden="true" />
			<em>{fileExtension(props.name)}</em>
			<span>{props.name}</span>
		</span>
	);
}
