import { describe, expect, test } from "bun:test";
import { isLoopbackRedirect, registerMcpClient } from "./mcp-oauth.ts";

describe("MCP client registration", () => {
	test("loopback redirects register as native first", async () => {
		const bodies: string[] = [];
		const registered = await registerMcpClient({
			registrationUrl: "https://mcp.linear.app/register",
			redirectUri: "http://127.0.0.1:9/oauth/callback",
			clientName: "Caelence agent",
			tokenEndpointAuthMethod: "none",
			fetchImpl: (async (_input, init) => {
				bodies.push(String(init?.body ?? ""));
				return Response.json({ client_id: "cli" });
			}) as typeof fetch,
		});
		expect(registered.clientId).toBe("cli");
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toContain('"application_type":"native"');
		expect(isLoopbackRedirect("http://127.0.0.1:9/oauth/callback")).toBe(true);
	});

	test("retries web after native 403 and reports Figma allowlisting", async () => {
		const types: string[] = [];
		await expect(
			registerMcpClient({
				registrationUrl: "https://api.figma.com/v1/oauth/mcp/register",
				redirectUri: "http://127.0.0.1:9/oauth/callback",
				clientName: "Caelence agent",
				fetchImpl: (async (_input, init) => {
					const body = JSON.parse(String(init?.body ?? "{}")) as { application_type?: string };
					types.push(body.application_type ?? "");
					return new Response("Forbidden", { status: 403 });
				}) as typeof fetch,
			}),
		).rejects.toThrow(/Figma blocked client registration \(403\)/);
		expect(types).toEqual(["native", "web"]);
	});
});
