import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");
const cargoHome = resolve(desktopDir, ".toolchain/cargo");
const rustupHome = resolve(desktopDir, ".toolchain/rustup");
const cargoBin = resolve(cargoHome, "bin");
const tauriBin = resolve(desktopDir, "node_modules/.bin/tauri");
const env = { ...process.env };
if (existsSync(resolve(cargoBin, "cargo"))) {
	env.CARGO_HOME = cargoHome;
	env.RUSTUP_HOME = rustupHome;
	env.PATH = `${cargoBin}:${env.PATH ?? ""}`;
}
if (!env.HARNESS_CWD) {
	env.HARNESS_CWD = resolve(desktopDir, "..");
}

function run(bin: string, args: string[]): Promise<number> {
	return new Promise((done) => {
		const child = spawn(bin, args, { cwd: desktopDir, env, stdio: "inherit" });
		child.on("exit", (code) => done(code ?? 1));
		child.on("error", (err) => {
			process.stderr.write(`${err.message}\n`);
			done(1);
		});
	});
}

if (!existsSync(tauriBin)) {
	process.stderr.write("Installing desktop dependencies…\n");
	const code = await run("bun", ["install"]);
	if (code !== 0 || !existsSync(tauriBin)) {
		process.stderr.write("Could not install @tauri-apps/cli. Run bun install in desktop/.\n");
		process.exit(1);
	}
}

process.exit(await run(tauriBin, ["dev"]));
