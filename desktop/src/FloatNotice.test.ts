import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FloatNotice, NOTICE_MS } from "./FloatNotice.tsx";

describe("FloatNotice", () => {
	test("drains on the same interval as the product notice", () => {
		expect(NOTICE_MS).toBe(4000);
	});

	test("shows the line and a dismiss control without taking document flow", () => {
		const html = renderToStaticMarkup(
			createElement(FloatNotice, {
				text: "Figma desktop MCP is not running",
				onDismiss: () => undefined,
			}),
		);
		expect(html).toContain("Figma desktop MCP is not running");
		expect(html).toContain('aria-label="Dismiss"');
		expect(html).toContain("<output");
		expect(html).toContain("desk-notice");
	});
});
