import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import type { ReactElement } from "react";

export interface UploadItem {
	name: string;
	rel: string;
	sourcePath?: string;
}

export function homePath(path: string): string {
	if (path.startsWith("/Users/")) {
		const cut = path.indexOf("/", 7);
		if (cut > 0) return `~${path.slice(cut)}`;
	}
	return path;
}

export function FilesPanel(
	props: Readonly<{
		items: UploadItem[];
		onOpen: (path: string, reveal: boolean) => void;
	}>,
): ReactElement {
	return (
		<div className="desk-integrations">
			<p className="desk-integrations-lead">Files you attached. Copies stay in this project.</p>
			{props.items.length === 0 ? (
				<p className="desk-side-empty">No uploaded files</p>
			) : (
				<ul className="desk-integration-list">
					{props.items.map((item) => (
						<li key={item.rel}>
							<span className="desk-integration-glyph desk-integration-mark" aria-hidden="true">
								{fileGlyph(item.name)}
							</span>
							<div>
								<p>{item.name}</p>
								<em>{item.sourcePath ? homePath(item.sourcePath) : "Copy in this project"}</em>
							</div>
							<div className="desk-integration-actions">
								<button
									type="button"
									className="cel-btn cel-btn--secondary cel-btn--compact"
									onClick={() => props.onOpen(item.rel, false)}
								>
									Open
								</button>
								<button
									type="button"
									className="cel-btn cel-btn--quiet cel-btn--compact"
									aria-label={`Show ${item.name} in folder`}
									onClick={() => props.onOpen(item.rel, true)}
								>
									<FolderSimpleIcon size={16} weight="regular" />
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function fileGlyph(name: string): string {
	const match = /\.([a-z0-9]{1,4})$/i.exec(name.trim());
	return (match?.[1] ?? "file").slice(0, 4).toUpperCase();
}
