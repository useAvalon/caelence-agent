import { describe, expect, test } from "bun:test";
import {
	pipelineProgress,
	prettySkillName,
	type SkillToolRef,
	skillIdFromTool,
} from "./pipeline.ts";

function tool(
	partial: Partial<SkillToolRef> & Pick<SkillToolRef, "name" | "label" | "status">,
): SkillToolRef {
	return {
		preview: "",
		...partial,
	};
}

describe("pipeline progress", () => {
	test("pretty-prints bundled skill ids", () => {
		expect(prettySkillName("copy-harry-dry")).toBe("Harry Dry");
		expect(prettySkillName("owner/repo@copy-rmbc")).toBe("RMBC");
	});

	test("reads the skill name from preview or label", () => {
		expect(
			skillIdFromTool(
				tool({
					key: "t1",
					name: "read_skill",
					label: "Reading skill",
					status: "running",
					preview: '{"name":"copywriting"}',
				}),
			),
		).toBe("copywriting");
		expect(
			skillIdFromTool(
				tool({
					key: "t2",
					name: "read_skill",
					label: "Reading Copy editor",
					status: "ok",
				}),
			),
		).toBe("Copy editor");
	});

	test("builds the copywriting track as skills run", () => {
		const pipe = pipelineProgress([
			tool({
				key: "t1",
				name: "read_skill",
				label: "Reading Copywriting",
				status: "ok",
				preview: '{"name":"copywriting"}',
			}),
			tool({
				key: "t2",
				name: "read_skill",
				label: "Reading RMBC",
				status: "running",
				preview: '{"name":"copy-rmbc"}',
			}),
		]);
		expect(pipe?.family).toBe("Copywriting");
		expect(pipe?.title).toBe("Running RMBC");
		expect(pipe?.steps.map((step) => step.status)).toEqual(["done", "run", "wait", "wait"]);
	});

	test("treats a lone skill as a one-step run", () => {
		const pipe = pipelineProgress([
			tool({
				key: "t1",
				name: "read_skill",
				label: "Reading skill",
				status: "running",
				preview: '{"name":"impeccable"}',
			}),
		]);
		expect(pipe).toEqual({
			family: "Impeccable",
			title: "Running Impeccable",
			steps: [{ id: "impeccable", label: "Impeccable", status: "run" }],
		});
	});
});
