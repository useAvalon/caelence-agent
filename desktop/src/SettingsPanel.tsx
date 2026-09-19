import { useEffect, useState } from "react";
import { errorMessage } from "../../src/core/errors";
import {
	type BridgeClient,
	type DesktopSettings,
	type DesktopState,
	getSettings,
	saveSettings,
} from "./api";
import type { ShowNotice, ThemeChoice } from "./desk-types";

export function SettingsPanel(
	props: Readonly<{
		bridge: BridgeClient;
		theme: ThemeChoice;
		onTheme: (theme: ThemeChoice) => void;
		onSaved: (state: DesktopState) => void;
		onNotice: ShowNotice;
	}>,
): React.ReactElement {
	const [settings, setSettings] = useState<DesktopSettings | null>(null);
	const [apiKey, setApiKey] = useState("");
	const [googleClientId, setGoogleClientId] = useState("");
	const [microsoftClientId, setMicrosoftClientId] = useState("");
	const [microsoftClientSecret, setMicrosoftClientSecret] = useState("");
	const [loadFailed, setLoadFailed] = useState(false);

	useEffect(() => {
		void getSettings(props.bridge)
			.then(setSettings)
			.catch((err: unknown) => {
				setLoadFailed(true);
				props.onNotice(errorMessage(err), "error");
			});
	}, [props.bridge, props.onNotice]);

	if (!settings) {
		return (
			<div className="desk-settings">
				<p className={loadFailed ? "desk-side-empty" : undefined}>
					{loadFailed ? "Settings could not be loaded" : "Loading settings"}
				</p>
			</div>
		);
	}

	return (
		<form
			className="desk-settings"
			onSubmit={(event) => {
				event.preventDefault();
				void (async () => {
					try {
						const result = await saveSettings(props.bridge, {
							mode: settings.mode,
							modelId: settings.modelId,
							...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
							...(googleClientId.trim() ? { googleClientId: googleClientId.trim() } : {}),
							...(microsoftClientId.trim() ? { microsoftClientId: microsoftClientId.trim() } : {}),
							...(microsoftClientSecret.trim()
								? { microsoftClientSecret: microsoftClientSecret.trim() }
								: {}),
						});
						setSettings({
							...settings,
							hasApiKey: result.hasApiKey,
							apiKeyHint: result.apiKeyHint,
							hasGoogleOAuth: result.hasGoogleOAuth,
							googleOAuthHint: result.googleOAuthHint,
							hasMicrosoftOAuth: result.hasMicrosoftOAuth,
							microsoftOAuthHint: result.microsoftOAuthHint,
						});
						setApiKey("");
						setGoogleClientId("");
						setMicrosoftClientId("");
						setMicrosoftClientSecret("");
						props.onSaved(result.state);
						props.onNotice("Saved");
					} catch (err) {
						props.onNotice(errorMessage(err), "error");
					}
				})();
			}}
		>
			<label>
				<span>OpenRouter API key</span>
				<input
					className="cel-input"
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={apiKey}
					placeholder={settings.hasApiKey ? settings.apiKeyHint : "sk-or-…"}
					onChange={(event) => setApiKey(event.target.value)}
				/>
				<em>
					{settings.hasApiKey
						? `Key on this machine · ${settings.apiKeyHint}`
						: "Stored in ~/.harness on this machine"}
				</em>
			</label>
			<label>
				<span>Google OAuth client id</span>
				<input
					className="cel-input"
					type="text"
					autoComplete="off"
					spellCheck={false}
					value={googleClientId}
					placeholder={settings.hasGoogleOAuth ? settings.googleOAuthHint : ""}
					onChange={(event) => setGoogleClientId(event.target.value)}
				/>
				<em>
					Google Workspace MCP has no dynamic client registration. Register a Desktop app in Google
					Cloud. Loopback redirect and PKCE. No client secret.
				</em>
			</label>
			<label>
				<span>Microsoft Entra client id</span>
				<input
					className="cel-input"
					type="text"
					autoComplete="off"
					spellCheck={false}
					value={microsoftClientId}
					placeholder={settings.hasMicrosoftOAuth ? settings.microsoftOAuthHint : ""}
					onChange={(event) => setMicrosoftClientId(event.target.value)}
				/>
			</label>
			<label>
				<span>Microsoft Entra client secret</span>
				<input
					className="cel-input"
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={microsoftClientSecret}
					placeholder={settings.hasMicrosoftOAuth ? "••••" : ""}
					onChange={(event) => setMicrosoftClientSecret(event.target.value)}
				/>
				<em>
					Required for Microsoft 365 directory MCP. Register a public client in Entra. Dynamic
					client registration is not supported. This server is users and groups, not Excel or
					Outlook.
				</em>
			</label>
			<label>
				<span>Theme</span>
				<span className="desk-select-wrap">
					<select
						className="cel-input desk-select"
						value={props.theme}
						onChange={(event) => props.onTheme(event.target.value as ThemeChoice)}
					>
						<option value="system">System</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				</span>
				<em>System follows the OS</em>
			</label>
			<label>
				<span>Mode</span>
				<span className="desk-select-wrap">
					<select
						className="cel-input desk-select"
						value={settings.mode}
						onChange={(event) => setSettings({ ...settings, mode: event.target.value })}
					>
						<option value="ask">Ask</option>
						<option value="plan">Plan</option>
						<option value="agent">Agent</option>
					</select>
				</span>
			</label>
			<button type="submit" className="cel-btn cel-btn--secondary cel-btn--compact">
				Save
			</button>
		</form>
	);
}
