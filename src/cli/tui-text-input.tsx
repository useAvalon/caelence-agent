import { Text, useInput } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import { applyTextInputKey } from "./tui-text-input.ts";
import { composerVisibleValue } from "./tui-text-input-display.ts";

const PROMPT = "> ";

export function TuiTextInput(
	props: Readonly<{
		value: string;
		width: number;
		enabled?: boolean;
		slashOpen?: boolean;
		onSlashUp?: () => void;
		onSlashDown?: () => void;
		onSlashTab?: () => void;
		onChange: (value: string) => void;
		onSubmit: (value: string) => void;
	}>,
): React.ReactElement {
	const enabled = props.enabled !== false;
	const [draft, setDraft] = useState(props.value);
	const [cursor, setCursor] = useState(props.value.length);

	useEffect(() => {
		setDraft(props.value);
		setCursor(props.value.length);
	}, [props.value]);

	useInput(
		(input, key) => {
			if (props.slashOpen) {
				if (key.upArrow) {
					props.onSlashUp?.();
					return;
				}
				if (key.downArrow) {
					props.onSlashDown?.();
					return;
				}
				if (key.tab) {
					props.onSlashTab?.();
					return;
				}
			}
			const next = applyTextInputKey(draft, cursor, input, key);
			if (!next) return;
			if (next.submit) {
				props.onSubmit(next.value);
				return;
			}
			setDraft(next.value);
			setCursor(next.cursor);
			if (next.value !== props.value) props.onChange(next.value);
		},
		{ isActive: enabled },
	);

	const visible = composerVisibleValue(draft, props.width, PROMPT.length);
	return (
		<Text wrap="truncate">
			{PROMPT}
			{visible}
		</Text>
	);
}
