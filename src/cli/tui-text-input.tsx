import { Text, useInput } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import { applyTextInputKey } from "./tui-text-input.ts";

export function TuiTextInput(
	props: Readonly<{
		value: string;
		onChange: (value: string) => void;
		onSubmit: (value: string) => void;
	}>,
): React.ReactElement {
	const [cursor, setCursor] = useState(props.value.length);

	useEffect(() => {
		setCursor((current) => Math.min(Math.max(current, 0), props.value.length));
	}, [props.value]);

	useInput((input, key) => {
		const next = applyTextInputKey(props.value, cursor, input, key);
		if (!next) return;
		if (next.submit) {
			props.onSubmit(next.value);
			return;
		}
		if (next.value !== props.value) props.onChange(next.value);
		setCursor(next.cursor);
	});

	const atEnd = cursor >= props.value.length;
	return (
		<Text>
			{props.value.slice(0, cursor)}
			<Text inverse>{atEnd ? " " : props.value.slice(cursor, cursor + 1)}</Text>
			{atEnd ? null : props.value.slice(cursor + 1)}
		</Text>
	);
}
