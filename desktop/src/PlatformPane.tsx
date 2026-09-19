import { ArrowsInIcon } from "@phosphor-icons/react/dist/csr/ArrowsIn";
import { ArrowsOutIcon } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import type { PublicIntegration } from "./api";
import { BubbleClip } from "./BubbleClip";
import { matchPlatform, platformTitle } from "./platform";
import type { ToolLine } from "./thought";

export function PlatformPane(
	props: Readonly<{
		line: ToolLine;
		integrations: PublicIntegration[];
		children?: ReactNode;
	}>,
): ReactElement {
	const { line, integrations } = props;
	const match = matchPlatform(line.name, integrations);
	const title = platformTitle(line.name, integrations);
	const [logoFailed, setLogoFailed] = useState(false);
	const [full, setFull] = useState(false);
	const clipKey = line.output ?? line.error ?? line.label;

	useEffect(() => {
		if (!full) return;
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "Escape") setFull(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [full]);

	const pane = (
		<article className={`desk-platform is-${line.status}${full ? " is-full" : ""}`}>
			<header className="desk-platform__chrome">
				<span className="desk-platform__brand">
					{match?.logoUrl && !logoFailed ? (
						<img
							src={match.logoUrl}
							alt=""
							width={16}
							height={16}
							onError={() => setLogoFailed(true)}
						/>
					) : (
						<span className="desk-platform__glyph">{match?.glyph ?? title.slice(0, 2)}</span>
					)}
					<span>{title}</span>
				</span>
				<span className="desk-platform__actions">
					{line.status === "running" ? (
						<span className="desk-platform__live">
							<span className="desk-event__spin" aria-hidden="true" />
							{line.label}
						</span>
					) : null}
					<button
						type="button"
						className="desk-platform__action"
						aria-label={full ? "Exit full screen" : "Full screen"}
						onClick={() => setFull((current) => !current)}
					>
						{full ? (
							<ArrowsInIcon size={16} weight="regular" aria-hidden="true" />
						) : (
							<ArrowsOutIcon size={16} weight="regular" aria-hidden="true" />
						)}
					</button>
				</span>
			</header>
			<div className="desk-platform__body">
				<BubbleClip text={clipKey} locked={full || line.status === "running"}>
					{platformBody(line, props.children)}
				</BubbleClip>
			</div>
		</article>
	);

	if (!full) return pane;
	return (
		<>
			<button
				type="button"
				className="desk-platform-scrim"
				aria-label="Exit full screen"
				onClick={() => setFull(false)}
			/>
			{pane}
		</>
	);
}

function platformBody(line: ToolLine, children: ReactNode): ReactNode {
	if (line.status === "fail" && line.error) {
		return <p className="desk-event__err">{line.error}</p>;
	}
	if (children) return children;
	return <p className="desk-platform__empty">{line.label}</p>;
}
