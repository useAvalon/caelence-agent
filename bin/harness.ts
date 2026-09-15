#!/usr/bin/env bun
import { main } from "../src/cli/main.ts";

main().then(
	(code) => process.exit(code),
	(err) => {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	},
);
