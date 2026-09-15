import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProviderOAuth, writeProviderOAuth } from "./oauth-clients.ts";

describe("Google OAuth client", () => {
	test("uses a Settings Desktop client id without a secret", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-oauth-store-"));
		const prevHome = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			writeProviderOAuth("google", { clientId: "user.apps.googleusercontent.com" });
			const env: Record<string, string | undefined> = { ...process.env, HARNESS_HOME: home };
			delete env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID;
			delete env.GOOGLE_OAUTH_CLIENT_ID;
			delete env.GOOGLE_CLIENT_ID;
			expect(readProviderOAuth("google", env)).toEqual({
				clientId: "user.apps.googleusercontent.com",
				clientSecret: "",
			});
		} finally {
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("uses a branded env client without a Settings paste", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-oauth-env-"));
		const prevHome = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		const env: Record<string, string | undefined> = {
			...process.env,
			HARNESS_HOME: home,
			CAELENCE_GOOGLE_OAUTH_CLIENT_ID: "caelence.apps.googleusercontent.com",
		};
		delete env.GOOGLE_OAUTH_CLIENT_ID;
		delete env.GOOGLE_CLIENT_ID;
		delete env.GOOGLE_CLIENT_SECRET;
		delete env.CAELENCE_GOOGLE_OAUTH_CLIENT_SECRET;
		try {
			expect(readProviderOAuth("google", env)).toEqual({
				clientId: "caelence.apps.googleusercontent.com",
				clientSecret: "",
			});
		} finally {
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("prefers a branded env client over a leftover Settings client", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-oauth-pref-"));
		const prevHome = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			writeProviderOAuth("google", {
				clientId: "legacy.apps.googleusercontent.com",
				clientSecret: "s",
			});
			const env = {
				...process.env,
				HARNESS_HOME: home,
				CAELENCE_GOOGLE_OAUTH_CLIENT_ID: "caelence.apps.googleusercontent.com",
			};
			expect(readProviderOAuth("google", env)?.clientId).toBe(
				"caelence.apps.googleusercontent.com",
			);
		} finally {
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(home, { recursive: true, force: true });
		}
	});
});
