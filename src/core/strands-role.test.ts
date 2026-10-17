import { describe, expect, test } from "bun:test";
import { roleForComputerKind, titleForRole } from "../cli/defaults.ts";
import { openRouterHeaders } from "./strands.ts";

describe("openrouter role titles", () => {
	test("Go to Notion uses the router title", () => {
		expect(openRouterHeaders(roleForComputerKind("direct"))["X-Title"]).toBe("agent:router");
		expect(openRouterHeaders("router")["X-Title"]).toBe(titleForRole("router"));
	});

	test("Notion create uses the writer title", () => {
		expect(openRouterHeaders(roleForComputerKind("complex"))["X-Title"]).toBe("agent:writer");
	});

	test("vision is only for image turns", () => {
		expect(openRouterHeaders("vision")["X-Title"]).toBe("agent:vision");
	});
});
