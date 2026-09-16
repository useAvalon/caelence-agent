import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config.ts";
import type { AgentEvent, MainModelProvider } from "../core/events.ts";
import type { ConstructAgent } from "../core/strands.ts";
import { createHarness } from "../runtime.ts";
import { listBundledSkills } from "../skills/loader.ts";
import { createReadSkillTool } from "./read-skill.ts";

const fakeProvider: MainModelProvider = {
	kind: "fake",
	modelId: "fake",
	async *stream() {
		yield { type: "done" };
	},
};

describe("read_skill", () => {
	test("reads a catalog skill and a reference file", async () => {
		const skills = listBundledSkills();
		const tool = createReadSkillTool(skills);
		const copy = await tool.handler({ name: "copywriting" });
		expect(copy.isError).toBeFalsy();
		expect(copy.content[0]?.text).toContain("RMBC");
		const slop = await tool.handler({ name: "copy-editor", file: "references/anti-slop.md" });
		expect(slop.isError).toBeFalsy();
		expect(slop.content[0]?.text).toContain("Never write");
		const visual = await tool.handler({ name: "impeccable", file: "references/visual-slop.md" });
		expect(visual.isError).toBeFalsy();
		expect(visual.content[0]?.text).toContain("Kickers");
		const missing = await tool.handler({ name: "not-a-skill" });
		expect(missing.isError).toBe(true);
	});

	test("asks for a catalog id when two loaded skills share a YAML name", async () => {
		const tool = createReadSkillTool([
			{
				name: "frontend-design",
				description: "a",
				body: "# Acme",
				path: "/tmp/acme/SKILL.md",
				relPath: "acme/SKILL.md",
				source: "user",
				catalogRef: "acme/pack/frontend-design",
			},
			{
				name: "frontend-design",
				description: "b",
				body: "# Other",
				path: "/tmp/other/SKILL.md",
				relPath: "other/SKILL.md",
				source: "user",
				catalogRef: "other/ui/frontend-design",
			},
		]);
		const ambiguous = await tool.handler({ name: "frontend-design" });
		expect(ambiguous.isError).toBe(true);
		expect(ambiguous.content[0]?.text).toContain("acme/pack/frontend-design");
		const picked = await tool.handler({ name: "other/ui/frontend-design" });
		expect(picked.isError).toBeFalsy();
		expect(picked.content[0]?.text).toContain("# Other");
	});
});

describe("task subagent", () => {
	test("nested agent can write a file and cannot spawn task", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-sub-"));
		try {
			let nestedSawTask = false;
			const constructAgent: ConstructAgent = (input) => ({
				async run(_message, emit) {
					const task = input.tools.find((t) => t.name === "task");
					if (task) {
						await task.invoke({ prompt: "write from-sub.txt", label: "writer" });
						emit({ kind: "text_delta", text: "parent" });
						return;
					}
					nestedSawTask = input.tools.some((t) => t.name === "task");
					const write = input.tools.find((t) => t.name === "write_file");
					if (!write) throw new Error("write_file missing");
					await write.invoke({ path: "from-sub.txt", content: "ok" });
					emit({ kind: "text_delta", text: "sub" });
				},
			});
			const harness = await createHarness({
				cwd,
				config: { ...DEFAULT_CONFIG, tools: { exec: { approval: "deny" } } },
				provider: fakeProvider,
				constructAgent,
				approvalPolicy: "deny",
			});
			const kinds: AgentEvent["kind"][] = [];
			await harness.runTurn("delegate", (event) => {
				kinds.push(event.kind);
			});
			expect(nestedSawTask).toBe(false);
			expect(kinds).toContain("tool_call_start");
			expect(await readFile(join(cwd, "from-sub.txt"), "utf8")).toBe("ok");
			harness.close();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
