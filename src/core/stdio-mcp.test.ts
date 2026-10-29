import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResult } from "./mcp.ts";
import { loadStdioMcpTools, textOnlyResult } from "./stdio-mcp.ts";

const dir = mkdtempSync(join(tmpdir(), "stdio-mcp-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fakeServer(name: string, body: string): string {
	const path = join(dir, `${name}.ts`);
	writeFileSync(path, body);
	return path;
}

const REPLY_LOOP = `
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
	buf += c;
	let i;
	while ((i = buf.indexOf("\\n")) >= 0) {
		const line = buf.slice(0, i);
		buf = buf.slice(i + 1);
		if (!line.trim()) continue;
		const req = JSON.parse(line);
		if (req.id === undefined) continue;
		if (req.method === "initialize") send({ jsonrpc: "2.0", id: req.id, result: {} });
		else if (req.method === "tools/list") send({ jsonrpc: "2.0", id: req.id, result: { tools: [{ name: "shot" }] } });
		else if (req.method === "tools/call") send({ jsonrpc: "2.0", id: req.id, result: { content: [
			{ type: "text", text: "meta" },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		] } });
	}
});
`;

describe("textOnlyResult", () => {
	test("keeps text and replaces other blocks with a placeholder", () => {
		const result = textOnlyResult({
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
				{ type: "audio" },
			],
			isError: false,
		} as unknown as ToolResult);
		expect(result.content.map((b) => b.text)).toEqual([
			"hello",
			"[image image/png omitted]",
			"[audio omitted]",
		]);
		expect(result.isError).toBe(false);
	});
});

describe("loadStdioMcpTools", () => {
	test("never hands image data to the model", async () => {
		const script = fakeServer("images", REPLY_LOOP);
		const { tools, close } = await loadStdioMcpTools({ command: "bun", args: [script] });
		try {
			const out = await tools[0]?.handler({});
			const texts = out?.content.map((b) => b.text) ?? [];
			expect(texts).toEqual(["meta", "[image image/png omitted]"]);
			expect(texts.join("")).not.toContain("AAAA");
		} finally {
			close();
		}
	});

	test("includes server stderr when startup fails", async () => {
		const script = fakeServer(
			"crash",
			`process.stderr.write("boom: missing dependency\\n"); process.exit(1);`,
		);
		await expect(
			loadStdioMcpTools({ command: "bun", args: [script], initTimeoutMs: 5000 }),
		).rejects.toThrow(/boom: missing dependency/);
	});

	test("keeps stderr from a server that prints and exits at once (smoke; the drain race itself is not deterministically reproducible)", async () => {
		for (let i = 0; i < 5; i++) {
			const script = fakeServer(
				`instant-${i}`,
				`process.stderr.write("fatal: cannot start\\n"); process.exit(3);`,
			);
			await expect(
				loadStdioMcpTools({ command: "bun", args: [script], initTimeoutMs: 5000 }),
			).rejects.toThrow(/fatal: cannot start/);
		}
	});

	test("honours initTimeoutMs", async () => {
		const script = fakeServer("hang", `setInterval(() => {}, 1000);`);
		const started = Date.now();
		await expect(
			loadStdioMcpTools({ command: "bun", args: [script], initTimeoutMs: 300 }),
		).rejects.toThrow(/timed out/);
		expect(Date.now() - started).toBeLessThan(4000);
	});

	test("does not stall when the server writes a lot to stderr", async () => {
		const script = fakeServer(
			"noisy",
			`for (let i = 0; i < 4000; i++) process.stderr.write("x".repeat(100) + "\\n");\n${REPLY_LOOP}`,
		);
		const { tools, close } = await loadStdioMcpTools({
			command: "bun",
			args: [script],
			initTimeoutMs: 8000,
		});
		try {
			expect(tools).toHaveLength(1);
		} finally {
			close();
		}
	});
});
