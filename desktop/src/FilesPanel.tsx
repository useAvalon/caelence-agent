import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { type ReactElement, useEffect, useState } from "react";
import { pruneSelected, toggleOne, toggleVisible } from "./session-select";

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
		onDelete: (rels: readonly string[]) => void | Promise<void>;
	}>,
): ReactElement {
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const [removing, setRemoving] = useState(false);

	useEffect(() => {
		const live = new Set(props.items.map((item) => item.rel));
		setSelected((prev) => pruneSelected(prev, live));
	}, [props.items]);

	const allSelected = props.items.length > 0 && props.items.every((item) => selected.has(item.rel));
	const someSelected = props.items.some((item) => selected.has(item.rel));

	const deleteSelected = () => {
		if (selected.size === 0 || removing) return;
		setRemoving(true);
		void Promise.resolve(props.onDelete([...selected])).finally(() => setRemoving(false));
	};

	return (
		<div className="desk-integrations">
			<p className="desk-integrations-lead">Open a file you dropped into a chat.</p>
			{props.items.length === 0 ? (
				<p className="desk-side-empty">No attachments yet</p>
			) : (
				<>
					<div className="desk-session-toolbar">
						<FileCheck
							checked={allSelected}
							indeterminate={someSelected && !allSelected}
							label="Select all"
							onChange={() =>
								setSelected((prev) =>
									toggleVisible(
										prev,
										props.items.map((item) => item.rel),
										allSelected,
									),
								)
							}
						/>
						<span className="desk-session-toolbar-meta">
							{selected.size > 0 ? `${selected.size} selected` : null}
						</span>
						<button
							type="button"
							className="cel-btn cel-btn--danger cel-btn--compact"
							disabled={selected.size === 0 || removing}
							aria-label={selected.size > 1 ? `Delete ${selected.size} files` : "Delete file"}
							onClick={deleteSelected}
						>
							<TrashIcon size={16} weight="regular" aria-hidden="true" />
						</button>
					</div>
					<ul className="desk-integration-list">
						{props.items.map((item) => (
							<li key={item.rel}>
								<FileCheck
									checked={selected.has(item.rel)}
									label={`Select ${item.name}`}
									onChange={() => setSelected((prev) => toggleOne(prev, item.rel))}
								/>
								<div>
									<p>{item.name}</p>
									<em>{item.sourcePath ? homePath(item.sourcePath) : "Dropped in chat"}</em>
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
				</>
			)}
		</div>
	);
}

function FileCheck(
	props: Readonly<{
		checked: boolean;
		indeterminate?: boolean;
		label: string;
		onChange: () => void;
	}>,
): ReactElement {
	return (
		<label className="desk-session-check">
			<input
				type="checkbox"
				checked={props.checked}
				ref={(node) => {
					if (node) node.indeterminate = Boolean(props.indeterminate);
				}}
				onChange={props.onChange}
			/>
			<span className="visually-hidden">{props.label}</span>
		</label>
	);
}
