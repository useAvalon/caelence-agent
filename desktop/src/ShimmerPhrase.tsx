import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from "react";

const CYCLE_MS = 2400;
const SWAP_MS = 320;

export function ShimmerPhrase(
	props: Readonly<{ phrases: readonly string[]; live: boolean; tone?: "pipe" }>,
): ReactElement {
	const phrases = props.phrases.length > 0 ? props.phrases : ["Thinking"];
	const key = phrases.join("\0");
	const phrasesRef = useRef(phrases);
	phrasesRef.current = phrases;
	const [index, setIndex] = useState(0);
	const [outgoing, setOutgoing] = useState<string | null>(null);
	const shown = phrases[index % phrases.length] ?? phrases[0] ?? "Thinking";

	useEffect(() => {
		setIndex(0);
		setOutgoing(null);
	}, [key]);

	useEffect(() => {
		if (!props.live) return;
		const timer = window.setInterval(() => {
			const list = phrasesRef.current;
			if (list.length < 2) return;
			setIndex((current) => {
				setOutgoing(list[current % list.length] ?? null);
				return (current + 1) % list.length;
			});
		}, CYCLE_MS);
		return () => window.clearInterval(timer);
	}, [key, props.live]);

	useEffect(() => {
		if (!outgoing) return;
		const timer = window.setTimeout(() => setOutgoing(null), SWAP_MS);
		return () => window.clearTimeout(timer);
	}, [outgoing]);

	const tone = props.tone === "pipe" ? " desk-shimmer--pipe" : "";

	if (!props.live) {
		return <span className={`desk-shimmer${tone}`}>{shown}</span>;
	}

	return (
		<span className={`desk-shimmer${tone}`} aria-live="polite">
			{outgoing ? (
				<span className="desk-shimmer__line is-out" aria-hidden="true">
					<ShimmerLetters text={outgoing} />
				</span>
			) : null}
			<span className={`desk-shimmer__line${outgoing ? " is-in" : ""}`}>
				<ShimmerLetters text={shown} />
			</span>
		</span>
	);
}

function ShimmerLetters(props: Readonly<{ text: string }>): ReactElement {
	return (
		<span className="desk-shimmer__letters">
			{[...props.text].map((letter, index) => (
				<span key={`${index}-${letter}`} style={{ "--i": index } as CSSProperties}>
					{letter === " " ? "\u00a0" : letter}
				</span>
			))}
		</span>
	);
}
