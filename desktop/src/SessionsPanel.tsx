import { SortAscendingIcon } from "@phosphor-icons/react/dist/csr/SortAscending";
import { SortDescendingIcon } from "@phosphor-icons/react/dist/csr/SortDescending";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import type { PickerItem } from "./api";
import { type SessionSort, sessionMatches, sortSessions } from "./session-search";
import { pruneSelected, toggleOne, toggleVisible } from "./session-select";

export function SessionsPanel(
	props: Readonly<{
		sessions: PickerItem[];
		busy: boolean;
		onOpen: (id: string) => void;
		onDelete: (ids: readonly string[]) => void | Promise<void>;
	}>,
): ReactElement {
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<SessionSort>("newest");
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const [removing, setRemoving] = useState(false);
	const visible = useMemo(
		() =>
			sortSessions(
				props.sessions.filter((item) => sessionMatches(item, query)),
				sort,
			),
		[props.sessions, query, sort],
	);

	useEffect(() => {
		const live = new Set(props.sessions.map((item) => item.id));
		setSelected((prev) => pruneSelected(prev, live));
	}, [props.sessions]);

	const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));
	const someVisibleSelected = visible.some((item) => selected.has(item.id));

	const deleteSelected = () => {
		if (selected.size === 0 || removing) return;
		setRemoving(true);
		void Promise.resolve(props.onDelete([...selected])).finally(() => setRemoving(false));
	};

	return (
		<div className="desk-integrations">
			<p className="desk-integrations-lead">Open a past chat.</p>
			<div className="desk-session-search">
				<label className="desk-field">
					<span className="visually-hidden">Search sessions</span>
					<input
						className="cel-input"
						value={query}
						placeholder="Search"
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
				<button
					type="button"
					className={`desk-session-sort${sort === "oldest" ? " is-on" : ""}`}
					aria-label={sort === "newest" ? "Newest first" : "Oldest first"}
					aria-pressed={sort === "oldest"}
					onClick={() => setSort((current) => (current === "newest" ? "oldest" : "newest"))}
				>
					{sort === "newest" ? (
						<SortDescendingIcon size={16} weight="regular" aria-hidden="true" />
					) : (
						<SortAscendingIcon size={16} weight="regular" aria-hidden="true" />
					)}
					<span className="desk-session-sort-label">
						<span
							className={sort === "newest" ? "is-on" : undefined}
							aria-hidden={sort !== "newest"}
						>
							Newest
						</span>
						<span
							className={sort === "oldest" ? "is-on" : undefined}
							aria-hidden={sort !== "oldest"}
						>
							Oldest
						</span>
					</span>
				</button>
			</div>
			{props.sessions.length === 0 ? (
				<p className="desk-side-empty">No saved sessions</p>
			) : (
				<>
					<div className="desk-session-toolbar">
						<SessionCheck
							checked={allVisibleSelected}
							indeterminate={someVisibleSelected && !allVisibleSelected}
							disabled={visible.length === 0}
							label="Select all"
							onChange={() =>
								setSelected((prev) =>
									toggleVisible(
										prev,
										visible.map((item) => item.id),
										allVisibleSelected,
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
							aria-label={selected.size > 1 ? `Delete ${selected.size} sessions` : "Delete session"}
							onClick={deleteSelected}
						>
							<TrashIcon size={16} weight="regular" aria-hidden="true" />
						</button>
					</div>
					{visible.length === 0 ? (
						<p className="desk-side-empty">No sessions match</p>
					) : (
						<ul className="desk-integration-list">
							{visible.map((item) => (
								<li key={item.id}>
									<SessionCheck
										checked={selected.has(item.id)}
										label={`Select ${item.label}`}
										onChange={() => setSelected((prev) => toggleOne(prev, item.id))}
									/>
									<div>
										<p>{item.label}</p>
										{item.hint ? <em>{item.hint}</em> : null}
									</div>
									<div className="desk-integration-actions">
										<button
											type="button"
											className="cel-btn cel-btn--secondary cel-btn--compact"
											disabled={props.busy}
											onClick={() => props.onOpen(item.id)}
										>
											Open
										</button>
									</div>
								</li>
							))}
						</ul>
					)}
				</>
			)}
		</div>
	);
}

function SessionCheck(
	props: Readonly<{
		checked: boolean;
		indeterminate?: boolean;
		disabled?: boolean;
		label: string;
		onChange: () => void;
	}>,
): ReactElement {
	return (
		<label className="desk-session-check">
			<input
				type="checkbox"
				checked={props.checked}
				disabled={props.disabled}
				ref={(node) => {
					if (node) node.indeterminate = Boolean(props.indeterminate);
				}}
				onChange={props.onChange}
			/>
			<span className="visually-hidden">{props.label}</span>
		</label>
	);
}
