import type { AgentEvent } from "./api";
import type { AttachmentPreview } from "./composer-files";
import { isPlatformTool, toolEventOutput } from "./platform";
import { inputFromPreview, toolLabel } from "./tool-label";

export type ToolStatus = "running" | "ok" | "fail";

export type StreamLine =
	| {
			key: string;
			type: "user";
			text: string;
			userTurnIndex: number;
			attachments?: AttachmentPreview[];
	  }
	| { key: string; type: "assistant"; text: string }
	| { key: string; type: "thought"; text: string }
	| {
			key: string;
			type: "tool";
			name: string;
			callId: string;
			status: ToolStatus;
			label: string;
			count: number;
			preview: string;
			error?: string;
			output?: string;
	  }
	| { key: string; type: "system"; text: string }
	| { key: string; type: "error"; text: string }
	| { key: string; type: "todos"; text: string }
	| {
			key: string;
			type: "media";
			kind: "image" | "video";
			src: string;
			caption: string;
			mimeType: string;
	  };

export function nextUserTurnIndex(lines: StreamLine[]): number {
	let count = 0;
	for (const line of lines) if (line.type === "user") count++;
	return count;
}

export function truncateAfterUserTurn(
	lines: StreamLine[],
	userTurnIndex: number,
	text: string,
): StreamLine[] {
	const idx = lines.findIndex(
		(line) => line.type === "user" && line.userTurnIndex === userTurnIndex,
	);
	if (idx < 0) return lines;
	const current = lines[idx];
	if (current?.type !== "user") return lines;
	return [...lines.slice(0, idx), { ...current, text }];
}

export function previewInput(input: Record<string, unknown>): string {
	const cmd = typeof input.command === "string" ? input.command : undefined;
	const path = typeof input.path === "string" ? input.path : undefined;
	const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
	const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
	const label = typeof input.label === "string" ? input.label : undefined;
	const name = typeof input.name === "string" ? input.name : undefined;
	const raw = label ?? cmd ?? path ?? pattern ?? prompt ?? name ?? JSON.stringify(input);
	return raw.length > 80 ? `${raw.slice(0, 79)}…` : raw;
}

export function applyEvent(lines: StreamLine[], event: AgentEvent): StreamLine[] {
	switch (event.kind) {
		case "text_delta": {
			const last = lines[lines.length - 1];
			if (last?.type === "assistant") {
				return [...lines.slice(0, -1), { ...last, text: last.text + event.text }];
			}
			return [...lines, { key: `a-${lines.length}`, type: "assistant", text: event.text }];
		}
		case "reasoning_delta": {
			const last = lines[lines.length - 1];
			if (last?.type === "thought") {
				return [...lines.slice(0, -1), { ...last, text: last.text + event.text }];
			}
			return [...lines, { key: `th-${lines.length}`, type: "thought", text: event.text }];
		}
		case "tool_call_start": {
			const label = toolLabel(event.toolName, event.input);
			const last = lines[lines.length - 1];
			if (
				last?.type === "tool" &&
				last.status !== "fail" &&
				last.label === label &&
				!isPlatformTool(event.toolName)
			) {
				return [
					...lines.slice(0, -1),
					{
						...last,
						key: event.callId,
						callId: event.callId,
						status: "running",
						count: last.count + 1,
						preview: previewInput(event.input),
					},
				];
			}
			return [
				...lines,
				{
					key: event.callId,
					type: "tool",
					name: event.toolName,
					callId: event.callId,
					status: "running",
					label,
					count: 1,
					preview: previewInput(event.input),
				},
			];
		}
		case "tool_call_end":
			return lines.map((line) =>
				line.type === "tool" && line.callId === event.callId
					? {
							...line,
							status: event.success ? "ok" : "fail",
							error: event.error,
							...(event.output
								? { output: event.output }
								: event.result !== undefined
									? { output: toolEventOutput(event.result) }
									: {}),
						}
					: line,
			);
		case "session_meta":
			return lines;
		case "error":
			return [...lines, { key: `e-${lines.length}`, type: "error", text: event.message }];
		case "todos":
			return [
				...lines,
				{
					key: `todo-${lines.length}`,
					type: "todos",
					text: event.items.map((item) => `${item.status} ${item.content}`).join(" · "),
				},
			];
		case "usage":
		case "completion":
		case "approval_request":
			return lines;
	}
}

export function linesFromTurns(
	messages: Array<{ role: "user" | "assistant"; content: string }>,
): StreamLine[] {
	return linesFromTranscript(
		messages.map((message) =>
			message.role === "user"
				? { kind: "user" as const, text: message.content }
				: { kind: "assistant" as const, text: message.content },
		),
	);
}

export function linesFromTranscript(
	messages: Array<
		| { kind: "user"; text: string }
		| { kind: "assistant"; text: string }
		| { kind: "thought"; text: string }
		| {
				kind: "tool";
				name: string;
				callId: string;
				status: ToolStatus;
				preview: string;
				error?: string;
				output?: string;
		  }
	>,
): StreamLine[] {
	let userTurnIndex = 0;
	return messages.map((message, index) => {
		if (message.kind === "user") {
			return {
				key: `u-${index}`,
				type: "user" as const,
				text: message.text,
				userTurnIndex: userTurnIndex++,
			};
		}
		if (message.kind === "assistant") {
			return { key: `a-${index}`, type: "assistant" as const, text: message.text };
		}
		if (message.kind === "thought") {
			return { key: `th-${index}`, type: "thought" as const, text: message.text };
		}
		return {
			key: message.callId || `t-${index}`,
			type: "tool" as const,
			name: message.name,
			callId: message.callId,
			status: message.status,
			label: toolLabel(message.name, inputFromPreview(message.preview)),
			count: 1,
			preview: message.preview,
			error: message.error,
			...(message.output ? { output: message.output } : {}),
		};
	});
}
