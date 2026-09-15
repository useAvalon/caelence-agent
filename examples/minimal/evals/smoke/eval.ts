import type { EvalSuite } from "../../../src/evals/runner.ts";

const suite: EvalSuite = {
	name: "smoke",
	steps: [
		{
			id: "echo",
			system: "Reply with exactly: ok",
			user: "ping",
			artifact: "echo.txt",
			scan: (text) => ({ ok: text.trim().toLowerCase().includes("ok") }),
		},
	],
};

export default suite;
