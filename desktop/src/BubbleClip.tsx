import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { type ReactElement, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { clipLineHeight, clipNeedsExpand, collapsedClipLimit } from "./clip.ts";

export function BubbleClip(
	props: Readonly<{
		text: string;
		locked?: boolean;
		children: ReactNode;
	}>,
): ReactElement {
	const [open, setOpen] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);
	const innerRef = useRef<HTMLDivElement>(null);
	const expanded = props.locked || open;

	useLayoutEffect(() => {
		setOpen(false);
	}, [props.text]);

	useLayoutEffect(() => {
		const clip = bodyRef.current;
		const inner = innerRef.current;
		if (!clip || !inner || props.locked) {
			if (props.locked) setOverflows(false);
			return;
		}
		setOverflows(
			clipNeedsExpand(inner.scrollHeight, collapsedClipLimit(clip), clipLineHeight(inner)),
		);
	}, [props.locked, props.text, props.children]);

	return (
		<div
			ref={bodyRef}
			className={`desk-line__clip${expanded ? " is-open" : ""}${overflows && !props.locked ? " has-more" : ""}`}
		>
			<div ref={innerRef} className="desk-line__clip-inner">
				{props.children}
			</div>
			{overflows && !props.locked ? (
				<>
					{open ? null : <div className="desk-line__fog" aria-hidden="true" />}
					<button
						type="button"
						className={`desk-line__more${open ? " is-open" : ""}`}
						aria-expanded={open}
						aria-label={open ? "Show less" : "Show more"}
						onClick={() => setOpen((current) => !current)}
					>
						<CaretDownIcon size={14} weight="bold" aria-hidden="true" />
					</button>
				</>
			) : null}
		</div>
	);
}
