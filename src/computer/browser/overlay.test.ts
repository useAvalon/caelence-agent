import { expect, test } from "bun:test";
import { OPEN_COMPOSER_SOURCE } from "./overlay.ts";

test("composer click matches a Post control, not a feed item", () => {
	expect(OPEN_COMPOSER_SOURCE).toContain('label === "post"');
	expect(OPEN_COMPOSER_SOURCE).toContain("/compose");
	expect(OPEN_COMPOSER_SOURCE).toContain("article, [role=article]");
	expect(OPEN_COMPOSER_SOURCE).not.toContain("[data-testid]");
});
