import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");
const cargoHome = resolve(desktopDir, ".toolchain/cargo");
const rustupHome = resolve(desktopDir, ".toolchain/rustup");
const cargoBin = resolve(cargoHome, "bin");
const env = { ...process.env };
if (existsSync(resolve(cargoBin, "cargo"))) {
	env.CARGO_HOME = cargoHome;
	env.RUSTUP_HOME = rustupHome;
	env.PATH = `${cargoBin}:${env.PATH ?? ""}`;
}
if (!env.HARNESS_CWD) {
	const fromDesktop = resolve(desktopDir, "..");
	env.HARNESS_CWD = fromDesktop;
}
const child = spawn("bun", ["x", "tauri", "dev"], {
	cwd: desktopDir,
	env,
	stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
