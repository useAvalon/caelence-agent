import { describe, expect, test } from "bun:test";
import { applyRoutineVars, generalizeTypedValues } from "./routines.ts";

describe("routines", () => {
	test("turns typed values into variables", () => {
		const { steps, variables } = generalizeTypedValues([
			{ kind: "type", label: "topic", text: "shipping update for friday" },
		]);
		expect(variables).toEqual(["topic"]);
		expect(steps[0]?.text).toBe("{{topic}}");
		expect(applyRoutineVars("{{topic}}", { topic: "hello" })).toBe("hello");
	});
});
