import { describe, expect, test } from "bun:test";
import { createBerryTools, normalizeWebUrl, searchUrl } from "./berry-tools.ts";

function tool(name: string, calls: string[][]) {
	const found = createBerryTools((args) => calls.push(args), { includeSearch: true }).find(
		(item) => item.name === name,
	);
	if (!found) throw new Error(`missing ${name}`);
	return found;
}

describe("berry tools", () => {
	test("voice berry omits open_search by default", () => {
		const names = createBerryTools().map((item) => item.name);
		expect(names).toEqual(["open_url", "open_app"]);
	});

	test("normalizes web addresses", () => {
		expect(normalizeWebUrl("example.com/docs/page")).toBe("https://example.com/docs/page");
		expect(normalizeWebUrl("https://www.example.com/path")).toBe("https://www.example.com/path");
		expect(normalizeWebUrl("file:///etc/passwd")).toBeUndefined();
		expect(normalizeWebUrl("javascript:alert(1)")).toBeUndefined();
		expect(normalizeWebUrl("not a url")).toBeUndefined();
		expect(normalizeWebUrl("nodot")).toBeUndefined();
	});

	test("open_url opens the browser", async () => {
		const calls: string[][] = [];
		const result = await tool("open_url", calls).handler({ url: "example.com/docs" });
		expect(result.isError).toBeFalsy();
		expect(calls).toEqual([["https://example.com/docs"]]);
	});

	test("open_url rejects other schemes", async () => {
		const calls: string[][] = [];
		const result = await tool("open_url", calls).handler({ url: "file:///tmp/x" });
		expect(result.isError).toBe(true);
		expect(calls).toEqual([]);
	});

	test("open_search encodes the query", async () => {
		const calls: string[][] = [];
		await tool("open_search", calls).handler({ query: "example search query" });
		expect(calls).toEqual([[searchUrl("example search query")]]);
		expect(searchUrl("a b&c")).toBe("https://www.google.com/search?q=a%20b%26c");
	});

	test("open_app only accepts plain names", async () => {
		const calls: string[][] = [];
		await tool("open_app", calls).handler({ name: "Safari" });
		const bad = await tool("open_app", calls).handler({ name: "../../bin/sh" });
		expect(bad.isError).toBe(true);
		expect(calls).toEqual([["-a", "Safari"]]);
	});
});
