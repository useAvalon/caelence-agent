import { LogoMark } from "./LogoMark";

export function DeskBoot(props: Readonly<{ error?: string }>): React.ReactElement {
	return (
		<div className="desk desk--boot">
			<header className="desk-bar">
				<LogoMark size={20} />
				<h1>Caelence</h1>
				{props.error ? null : (
					<span className="cel-chip cel-chip--run">
						<span className="cel-chip__spin" aria-hidden="true" />
						{"Starting"}
					</span>
				)}
			</header>
			<main className="desk-empty">
				{props.error ? (
					<>
						<p>{props.error}</p>
						<p>Open this UI from the Caelence agent window, not a browser tab.</p>
					</>
				) : (
					<p>Starting the local runtime</p>
				)}
			</main>
		</div>
	);
}
