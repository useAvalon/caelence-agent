import type { ReactElement } from "react";

export function DeskToggle(
	props: Readonly<{
		checked: boolean;
		pending?: boolean;
		disabled?: boolean;
		label: string;
		onChange: (checked: boolean) => void;
	}>,
): ReactElement {
	return (
		<button
			type="button"
			role="switch"
			className={`desk-toggle${props.checked ? " is-on" : ""}${props.pending ? " is-pending" : ""}`}
			aria-checked={props.checked}
			aria-busy={props.pending ?? false}
			aria-label={props.label}
			disabled={props.pending || props.disabled}
			onClick={() => props.onChange(!props.checked)}
		>
			<span className="desk-toggle__thumb" aria-hidden="true">
				{props.pending ? <span className="cel-chip__spin" /> : null}
			</span>
		</button>
	);
}
