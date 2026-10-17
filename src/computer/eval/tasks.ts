export interface ComputerEvalTask {
	id: string;
	title: string;
	prompt: string;
}

/** Fixed tasks for local timing. They are not run in CI. */
export const COMPUTER_EVAL_TASKS: ComputerEvalTask[] = [
	{
		id: "draft-post",
		title: "Draft a social post and stop before publishing",
		prompt: "Write a draft post about {topic} and stop before publishing.",
	},
	{
		id: "search-third",
		title: "Search and open the third result",
		prompt: "Search the web for {query}, open the third result, and summarize it.",
	},
	{
		id: "local-form",
		title: "Fill a local form",
		prompt: "Fill the form on the local test page.",
	},
	{
		id: "mail-draft",
		title: "Draft a mail reply without sending",
		prompt: "Draft a reply to the newest mail from {sender}. Do not send.",
	},
	{
		id: "notes",
		title: "Create a Notes note",
		prompt: "Create a note with this text: {body}",
	},
	{
		id: "finder-downloads",
		title: "Open Downloads sorted by date",
		prompt: "Open the Downloads folder sorted by date.",
	},
	{
		id: "template-search",
		title: "Search templates on the open design tab",
		prompt: "In the open design tab, open template search and search for {query}.",
	},
	{
		id: "switch-tab",
		title: "Switch tab and scroll to a heading",
		prompt: "Switch to the already open tab matching {title} and scroll to {heading}.",
	},
	{
		id: "dismiss-modal",
		title: "Dismiss a cookie banner then continue",
		prompt: "Dismiss the cookie banner or modal, then continue the task.",
	},
	{
		id: "replay-routine",
		title: "Replay a saved routine",
		prompt: "Run the saved routine {name} with {vars}.",
	},
	{
		id: "local-composer",
		title: "Fill the local dialog editor and stop before sending",
		prompt:
			"On the local test page, open the dialog and type a draft about {topic}. Stop before the submit button.",
	},
];
