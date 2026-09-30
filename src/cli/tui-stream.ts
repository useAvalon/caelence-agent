export type ToolStatus = "running" | "ok" | "fail";

export type StreamLine =
	| { key: string; type: "user"; text: string }
	| { key: string; type: "assistant"; text: string }
	| { key: string; type: "thought"; text: string }
	| {
			key: string;
			type: "tool";
			name: string;
			callId: string;
			status: ToolStatus;
			preview: string;
			error?: string;
	  }
	| { key: string; type: "system"; text: string }
	| { key: string; type: "error"; text: string }
	| { key: string; type: "todos"; text: string };

export type TurnToolLine = {
	callId: string;
	name: string;
	status: ToolStatus;
	preview: string;
	error?: string;
};
