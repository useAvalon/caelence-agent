import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../src/core/errors";
import {
	addSkill,
	type BridgeClient,
	getPopularSkills,
	getSkills,
	type PublicSkill,
	removeSkill,
	type SkillsPage,
	searchSkills,
} from "./api";
import { formatSkillInstalls, omitCatalogSkill, skillMatches } from "./skill-search";

function skillTitle(item: PublicSkill): string {
	return item.name;
}

function skillGlyph(item: PublicSkill): string {
	const letters = skillTitle(item)
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(0, 2);
	return letters.toUpperCase() || "SK";
}

function skillDetail(item: PublicSkill): string {
	if (item.origin === "bundled") {
		return item.description || "Bundled with the app";
	}
	const installs =
		item.installs !== undefined ? `${formatSkillInstalls(item.installs)} installs` : "";
	return [item.source, item.description, installs].filter(Boolean).join(" · ");
}

function pendingSkillLabel(status: PublicSkill["status"]): string {
	if (status === "user") return "Removing";
	if (status === "project") return "Disabling";
	return "Adding";
}

function SkillActions(
	props: Readonly<{
		item: PublicSkill;
		pending: boolean;
		onAdd: () => void;
		onRemove: () => void;
	}>,
): ReactElement {
	const { item } = props;
	if (props.pending) {
		return (
			<span className="desk-integration-ok">
				<span className="cel-chip__spin" aria-hidden="true" />
				{pendingSkillLabel(item.status)}
			</span>
		);
	}
	if (item.status === "project") {
		return (
			<>
				<span className="desk-integration-ok">
					<CheckIcon size={16} weight="regular" aria-hidden="true" />
					In project
				</span>
				<button
					type="button"
					className="cel-btn cel-btn--quiet cel-btn--compact"
					onClick={props.onRemove}
				>
					Disable
				</button>
			</>
		);
	}
	if (item.status === "user") {
		return (
			<>
				<span className="desk-integration-ok">
					<CheckIcon size={16} weight="regular" aria-hidden="true" />
					Added
				</span>
				<button
					type="button"
					className="cel-btn cel-btn--quiet cel-btn--compact"
					onClick={props.onRemove}
				>
					Remove
				</button>
			</>
		);
	}
	return (
		<button
			type="button"
			className="cel-btn cel-btn--secondary cel-btn--compact"
			onClick={props.onAdd}
		>
			Add
		</button>
	);
}

function SkillRow(
	props: Readonly<{
		item: PublicSkill;
		pending: boolean;
		onAdd: () => void;
		onRemove: () => void;
	}>,
): ReactElement {
	const { item } = props;
	return (
		<li>
			<span className="desk-integration-glyph desk-integration-mark">{skillGlyph(item)}</span>
			<div>
				<p>{skillTitle(item)}</p>
				<em>{skillDetail(item)}</em>
			</div>
			<div className="desk-integration-actions">
				<SkillActions
					item={item}
					pending={props.pending}
					onAdd={props.onAdd}
					onRemove={props.onRemove}
				/>
			</div>
		</li>
	);
}

function SkillsRemoteBlock(
	props: Readonly<{
		searching: boolean;
		query: string;
		remote: PublicSkill[] | null;
		remoteVisible: PublicSkill[];
		popular: PublicSkill[];
		pendingId: string | null;
		onAdd: (id: string) => void;
		onRemove: (id: string) => void;
	}>,
): ReactElement | null {
	if (props.searching) {
		if (props.remote === null) {
			return <p className="desk-side-empty">Searching skills.sh</p>;
		}
		if (props.remoteVisible.length === 0) return null;
		return (
			<>
				<div className="desk-integration-split">
					<p>skills.sh</p>
					<em>Matches for “{props.query.trim()}”.</em>
				</div>
				<SkillList
					items={props.remoteVisible}
					pendingId={props.pendingId}
					onAdd={props.onAdd}
					onRemove={props.onRemove}
				/>
			</>
		);
	}
	if (props.popular.length === 0) return null;
	return (
		<>
			<div className="desk-integration-split">
				<p>Popular on skills.sh</p>
				<em>A short cached list. Type in the search bar to find more.</em>
			</div>
			<SkillList
				items={props.popular}
				pendingId={props.pendingId}
				onAdd={props.onAdd}
				onRemove={props.onRemove}
			/>
		</>
	);
}

function SkillList(
	props: Readonly<{
		items: PublicSkill[];
		pendingId: string | null;
		onAdd: (id: string) => void;
		onRemove: (id: string) => void;
	}>,
): ReactElement | null {
	if (props.items.length === 0) return null;
	return (
		<ul className="desk-integration-list">
			{props.items.map((item) => (
				<SkillRow
					key={item.id}
					item={item}
					pending={props.pendingId === item.id}
					onAdd={() => props.onAdd(item.id)}
					onRemove={() => props.onRemove(item.id)}
				/>
			))}
		</ul>
	);
}

export function SkillsPanel(
	props: Readonly<{
		bridge: BridgeClient;
		query: string;
		onQuery: (value: string) => void;
		onNotice: (text: string) => void;
	}>,
): ReactElement {
	const [page, setPage] = useState<SkillsPage | null>(null);
	const [remote, setRemote] = useState<PublicSkill[] | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const searching = props.query.trim().length >= 2;

	useEffect(() => {
		let alive = true;
		let popular: PublicSkill[] | null = null;
		void getSkills(props.bridge)
			.then((result) => {
				if (!alive) return;
				setPage(popular ? { ...result, popular } : result);
			})
			.catch((err: unknown) => {
				if (!alive) return;
				setLoadFailed(true);
				props.onNotice(errorMessage(err));
			});
		void getPopularSkills(props.bridge)
			.then((result) => {
				if (!alive) return;
				popular = result.popular;
				setPage((current) => (current ? { ...current, popular: result.popular } : current));
			})
			.catch(() => {
				// Seed/cached popular from GET /skills is enough.
			});
		return () => {
			alive = false;
		};
	}, [props.bridge, props.onNotice]);

	useEffect(() => {
		if (!searching) {
			setRemote(null);
			return;
		}
		const q = props.query.trim();
		let alive = true;
		const timer = window.setTimeout(() => {
			void searchSkills(props.bridge, q)
				.then((result) => {
					if (alive) setRemote(result.items);
				})
				.catch((err: unknown) => {
					if (!alive) return;
					props.onNotice(errorMessage(err));
				});
		}, 250);
		return () => {
			alive = false;
			window.clearTimeout(timer);
		};
	}, [props.bridge, props.onNotice, props.query, searching]);

	const applyPage = (next: SkillsPage) => {
		setPage(next);
		if (!searching) return;
		const byId = new Map(
			[...next.bundled, ...next.popular, ...next.loaded].map((item) => [item.id, item]),
		);
		setRemote((current) => (current ?? []).map((item) => byId.get(item.id) ?? item));
	};

	const run = async (id: string, action: "add" | "remove"): Promise<void> => {
		setPendingId(id);
		try {
			const result =
				action === "add" ? await addSkill(props.bridge, id) : await removeSkill(props.bridge, id);
			applyPage(result);
		} catch (err) {
			props.onNotice(errorMessage(err));
			if (action === "add") {
				setRemote((current) => (current ? omitCatalogSkill(current, id) : current));
				setPage((current) =>
					current
						? {
								...current,
								popular: omitCatalogSkill(current.popular, id),
								loaded: omitCatalogSkill(current.loaded, id),
							}
						: current,
				);
			}
		} finally {
			setPendingId(null);
		}
	};

	const bundled = useMemo(
		() => (page?.bundled ?? []).filter((item) => skillMatches(item, props.query)),
		[page, props.query],
	);
	const popular = useMemo(
		() => (page?.popular ?? []).filter((item) => skillMatches(item, props.query)),
		[page, props.query],
	);
	const loaded = useMemo(
		() => (page?.loaded ?? []).filter((item) => skillMatches(item, props.query)),
		[page, props.query],
	);
	const remoteVisible = useMemo(() => {
		if (!remote) return [];
		const seen = new Set([...bundled, ...popular].map((item) => item.id));
		return remote.filter((item) => !seen.has(item.id));
	}, [bundled, popular, remote]);

	if (!page && !loadFailed) {
		return (
			<div className="desk-integrations">
				<p>Loading skills</p>
			</div>
		);
	}

	if (!page && loadFailed) {
		return (
			<div className="desk-integrations">
				<p className="desk-side-empty">Skills could not be loaded</p>
			</div>
		);
	}

	const emptySearch =
		searching &&
		remote !== null &&
		bundled.length === 0 &&
		remoteVisible.length === 0 &&
		loaded.length === 0;

	return (
		<div className="desk-integrations">
			<label className="desk-field">
				<span className="visually-hidden">Search skills</span>
				<input
					className="cel-input"
					value={props.query}
					placeholder="Search skills.sh"
					onChange={(event) => props.onQuery(event.target.value)}
				/>
			</label>
			{emptySearch ? (
				<p className="desk-side-empty">No skills match</p>
			) : (
				<>
					{!searching && loaded.length > 0 ? (
						<>
							<div className="desk-integration-split">
								<p>Added</p>
								<em>Installed for your user. Remove takes them out of ~/.harness/skills.</em>
							</div>
							<SkillList
								items={loaded}
								pendingId={pendingId}
								onAdd={(id) => void run(id, "add")}
								onRemove={(id) => void run(id, "remove")}
							/>
						</>
					) : null}
					{bundled.length > 0 ? (
						<>
							{searching ? null : (
								<div className="desk-integration-split">
									<p>Bundled</p>
								</div>
							)}
							<SkillList
								items={bundled}
								pendingId={pendingId}
								onAdd={(id) => void run(id, "add")}
								onRemove={(id) => void run(id, "remove")}
							/>
						</>
					) : null}
					<SkillsRemoteBlock
						searching={searching}
						query={props.query}
						remote={remote}
						remoteVisible={remoteVisible}
						popular={popular}
						pendingId={pendingId}
						onAdd={(id) => void run(id, "add")}
						onRemove={(id) => void run(id, "remove")}
					/>
				</>
			)}
		</div>
	);
}
