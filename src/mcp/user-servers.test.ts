import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	addUserMcpServer,
	isHttpMcpUrl,
	listPublicMcps,
	listUserMcpServers,
	parseAddUserMcp,
	parseMcpServersJson,
	removeUserMcpServer,
	splitMcpArgs,
	userMcpPath,
	userMcpToolPrefix,
} from "./user-servers.ts";

describe("user MCP servers", () => {
	test("splits quoted command args", () => {
		expect(splitMcpArgs(`npx -y "@ag-grid/mcp-server"`)).toEqual([
			"npx",
			"-y",
			"@ag-grid/mcp-server",
		]);
	});

	test("accepts http MCP urls only", () => {
		expect(isHttpMcpUrl("https://mcp.example.com/mcp")).toBe(true);
		expect(isHttpMcpUrl("http://127.0.0.1:3100/mcp")).toBe(true);
		expect(isHttpMcpUrl("file:///tmp/mcp")).toBe(false);
		expect(isHttpMcpUrl("javascript:alert(1)")).toBe(false);
	});

	test("namespaces user tools away from hosted connectors", () => {
		expect(userMcpToolPrefix("ag-grid")).toBe("mcp_ag_grid");
	});

	test("parses a pasted local command into argv", () => {
		const parsed = parseAddUserMcp({ command: "npx -y @ag-grid/mcp-server", label: "AG Grid" }, []);
		expect(parsed).toEqual({
			ok: {
				id: "ag-grid",
				label: "AG Grid",
				kind: "stdio",
				command: "npx",
				args: ["-y", "@ag-grid/mcp-server"],
			},
		});
	});

	test("round-trips a local server and hides tokens on the public list", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-mcp-"));
		try {
			const added = addUserMcpServer(cwd, {
				kind: "http",
				url: "https://mcp.example.com/mcp",
				token: "secret-token",
				label: "Example",
			});
			expect("ok" in added).toBe(true);
			const stored = listUserMcpServers(cwd);
			expect(stored[0]?.token).toBe("secret-token");
			const listed = listPublicMcps(cwd, [{ command: "uvx", args: ["demo-mcp"] }]);
			expect(listed.map((item) => item.id)).toEqual(["example", "config-0"]);
			expect(listed[0]?.detail).toBe("https://mcp.example.com/mcp · token set");
			expect(JSON.stringify(listed)).not.toContain("secret-token");
			expect(listed[1]?.removable).toBe(false);
			const raw = await readFile(userMcpPath(cwd), "utf8");
			expect(raw).toContain("secret-token");
			expect(removeUserMcpServer(cwd, "example")).toBe(true);
			expect(listUserMcpServers(cwd)).toEqual([]);
			expect(removeUserMcpServer(cwd, "config-0")).toBe(false);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("parses a pasted mcpServers JSON block", () => {
		const parsed = parseMcpServersJson(`{
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "env": {},
      "disabled": true,
      "autoApprove": []
    }
  }
}`);
		expect(parsed).toEqual({
			ok: [
				{
					kind: "stdio",
					label: "fetch",
					command: "uvx",
					args: ["mcp-server-fetch"],
				},
			],
		});
	});

	test("adds a pasted mcpServers JSON block", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-mcp-json-"));
		try {
			const added = addUserMcpServer(cwd, {
				kind: "stdio",
				command: `{
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}`,
			});
			expect(added).toMatchObject({
				ok: {
					label: "fetch",
					kind: "stdio",
					command: "uvx",
					args: ["mcp-server-fetch"],
				},
			});
			expect(listUserMcpServers(cwd)[0]?.command).toBe("uvx");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("rejects a duplicate command already in harness.config.ts", () => {
		const parsed = parseAddUserMcp(
			{ command: "uvx", args: ["demo-mcp"] },
			[],
			[{ command: "uvx", args: ["demo-mcp"] }],
		);
		expect(parsed).toEqual({ error: "That MCP is already in harness.config.ts." });
	});
});
