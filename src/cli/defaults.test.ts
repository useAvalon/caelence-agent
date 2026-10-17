import { describe, expect, test } from "bun:test";
import { DEFAULT_MODELS, modelFitsRole, roleForComputerKind, titleForRole } from "./defaults.ts";

describe("role defaults", () => {
	test("jev routes and flash writes and sees", () => {
		expect(DEFAULT_MODELS.router).toBe("typesafe/jev-1.13");
		expect(DEFAULT_MODELS.navigator).toBe("typesafe/jev-1.13");
		expect(DEFAULT_MODELS.utility).toBe("typesafe/jev-1.13");
		expect(DEFAULT_MODELS.writer).toContain("gemini");
		expect(DEFAULT_MODELS.vision).toContain("gemini");
		expect(titleForRole("writer")).toBe("agent:writer");
		expect(titleForRole(roleForComputerKind("direct"))).toBe("agent:router");
		expect(titleForRole(roleForComputerKind("complex"))).toBe("agent:writer");
	});

	test("vision without images is blocked", () => {
		expect(modelFitsRole("vision", { image: false })).toMatch(/image/i);
		expect(modelFitsRole("navigator", { tools: false })).toMatch(/tool/i);
		expect(modelFitsRole("vision", { image: true })).toBeUndefined();
	});
});
