import { describe, expect, test } from "bun:test";
import type { Skill } from "../skills/loader.ts";
import { plainTerminalText } from "./plain-text.ts";
import {
	completeSlashCommand,
	filterSlashCommands,
	formatIntegrationList,
	formatSkillList,
	formatSlashCommand,
	isHelpAlias,
	parseSlashLine,
	resolveSlashSubmit,
	SLASH_COMMANDS,
	SLASH_HELP,
} from "./slash.ts";

describe("slash palette", () => {
	test("lists every command on /", () => {
		expect(filterSlashCommands("/").map((item) => item.name)).toEqual(
			SLASH_COMMANDS.map((item) => item.name),
		);
	});

	test("filters as you type", () => {
		expect(filterSlashCommands("/sk").map((item) => item.name)).toEqual([
			"skills",
			"skill add",
			"skill find",
			"skill new",
			"skill remove",
		]);
		expect(filterSlashCommands("/skill a").map((item) => item.name)).toEqual(["skill add"]);
		expect(filterSlashCommands("/mode").map((item) => item.name)).toEqual(["model", "mode"]);
		expect(filterSlashCommands("/help").map((item) => item.name)).toEqual(["help"]);
		expect(filterSlashCommands("/image").map((item) => item.name)).toEqual(["image"]);
		expect(filterSlashCommands("/int").map((item) => item.name)).toEqual(["integrations"]);
	});

	test("puts argument slots on the command, not the hint", () => {
		const evalCmd = SLASH_COMMANDS.find((item) => item.name === "eval");
		expect(evalCmd).toMatchObject({ slot: "[name]", hint: "run an eval suite" });
		expect(formatSlashCommand(evalCmd!)).toBe("/eval [name]");
		expect(SLASH_HELP).toContain("/eval [name] · run an eval suite");
		expect(SLASH_HELP).toContain("/image [prompt] · generate an image");
		expect(SLASH_HELP).toContain("/skill find [query] · browse bundled and skills.sh");
		expect(SLASH_HELP).not.toContain("/eval ·");
	});

	test("completes commands that take an argument with a trailing space", () => {
		expect(completeSlashCommand({ name: "help", hint: "x" })).toBe("/help");
		expect(completeSlashCommand({ name: "skill add", hint: "x", arg: true })).toBe("/skill add ");
	});

	test("parses two-word skill commands", () => {
		expect(parseSlashLine("/skill add anthropics/skills@frontend-design")).toEqual({
			cmd: "skill add",
			arg: "anthropics/skills@frontend-design",
		});
	});

	test("treats --help as a command, not a chat turn", () => {
		expect(isHelpAlias("--help")).toBe(true);
		expect(isHelpAlias("help")).toBe(true);
		expect(isHelpAlias("what is help")).toBe(false);
	});

	test("lists skills as name and source only", () => {
		const skills = [
			{
				name: "copywriting",
				description: "Routes copy work through a long folded YAML description that must not dump.",
				body: "# huge",
				path: "/tmp/copywriting/SKILL.md",
				relPath: "copywriting/SKILL.md",
				source: "host",
			},
		] satisfies Skill[];
		expect(formatSkillList(skills)).toBe("copywriting  project");
		expect(formatSkillList(skills)).not.toContain("Routes copy");
	});

	test("lists integrations as name and on/off", () => {
		expect(
			formatIntegrationList([
				{ label: "Linear", connected: true },
				{ label: "Figma", connected: false, auth: "desktop" },
			]),
		).toBe("Linear  on\nFigma  off");
	});
});

describe("resolveSlashSubmit", () => {
	test("keeps commands that still need an argument in the composer", () => {
		expect(resolveSlashSubmit("/skill add")).toEqual({ action: "complete", line: "/skill add " });
		expect(resolveSlashSubmit("/skill find billing")).toEqual({
			action: "send",
			line: "/skill find billing",
		});
	});

	test("completes a unique prefix instead of sending an unknown command", () => {
		expect(resolveSlashSubmit("/ima")).toEqual({ action: "complete", line: "/image " });
		expect(resolveSlashSubmit("/vid")).toEqual({ action: "complete", line: "/video " });
	});

	test("does not send a bare slash or an unknown prefix", () => {
		expect(resolveSlashSubmit("/")).toEqual({ action: "hold" });
		expect(resolveSlashSubmit("/asdf")).toEqual({ action: "hold" });
	});

	test("sends the highlighted command when the prefix is still ambiguous", () => {
		const integrations = SLASH_COMMANDS.find((item) => item.name === "integrations");
		expect(integrations).toBeDefined();
		expect(resolveSlashSubmit("/i", integrations)).toEqual({
			action: "send",
			line: "/integrations",
		});
		expect(resolveSlashSubmit("/i")).toEqual({ action: "hold" });
	});

	test("opens pickers for empty model, mode, and media commands", () => {
		expect(resolveSlashSubmit("/image")).toEqual({ action: "send", line: "/image" });
		expect(resolveSlashSubmit("/mode")).toEqual({ action: "send", line: "/mode" });
		expect(resolveSlashSubmit("/integrations")).toEqual({ action: "send", line: "/integrations" });
		expect(resolveSlashSubmit("/skill find")).toEqual({ action: "send", line: "/skill find" });
		expect(resolveSlashSubmit("/settings")).toEqual({ action: "send", line: "/settings" });
	});
});

describe("plainTerminalText", () => {
	test("strips markdown markers", () => {
		expect(plainTerminalText("I'm **caelence**, a `coding` agent")).toBe(
			"I'm caelence, a coding agent",
		);
	});
});
