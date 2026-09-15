/** Strip markdown so a terminal line does not render as `**bold**`. */
export function plainTerminalText(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, (block) =>
			block
				.replace(/^```\w*\n?/, "")
				.replace(/```$/, "")
				.trim(),
		)
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1$2");
}
