/**
 * Short overlay at the top of the main pane. Dismiss with the close control
 * or wait for the timer bar to run out. Matches the builder FloatNotice.
 */

import { X } from "@phosphor-icons/react/dist/csr/X";
import { useEffect } from "react";

export const NOTICE_MS = 4000;

export function FloatNotice(props: { text: string; onDismiss: () => void }): React.ReactElement {
	const { text, onDismiss } = props;
	useEffect(() => {
		const id = window.setTimeout(onDismiss, NOTICE_MS);
		return () => window.clearTimeout(id);
	}, [onDismiss]);
	return (
		<output className="desk-notice cel-float">
			<span className="desk-notice__label">{text}</span>
			<button type="button" className="desk-notice__close" aria-label="Dismiss" onClick={onDismiss}>
				<X size={16} weight="regular" />
			</button>
			<span className="desk-notice__timer" aria-hidden="true">
				<span className="desk-notice__bar" style={{ animationDuration: `${NOTICE_MS}ms` }} />
			</span>
		</output>
	);
}
