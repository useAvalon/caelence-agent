import type { ReactElement } from "react";
import type { PipeStep } from "./pipeline";

export function PipelineTrack(
	props: Readonly<{ steps: readonly PipeStep[] }>,
): ReactElement | null {
	if (props.steps.length === 0) return null;
	const label = props.steps.map((step) => step.label).join(", ");
	return (
		<div className="desk-pipe" role="img" aria-label={label}>
			{props.steps.map((step, index) => (
				<span key={step.id} className={`desk-pipe__unit is-${step.status}`}>
					{index > 0 ? <span className="desk-pipe__seg" aria-hidden="true" /> : null}
					<span className="desk-pipe__dot" aria-hidden="true" />
				</span>
			))}
		</div>
	);
}
