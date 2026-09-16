import { Component, type ErrorInfo, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens-matte.css";
import "./styles/fonts.css";
import "./styles/primitives.css";
import "./app.css";

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error): { error: Error } {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(error, info.componentStack);
	}

	render(): ReactNode {
		if (this.state.error) {
			return (
				<div className="desk desk--boot">
					<main className="desk-empty">
						<p>Caelence agent failed to load.</p>
						<pre className="cel-code">{this.state.error.message}</pre>
					</main>
				</div>
			);
		}
		return this.props.children;
	}
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
	<StrictMode>
		<RootErrorBoundary>
			<App />
		</RootErrorBoundary>
	</StrictMode>,
);
