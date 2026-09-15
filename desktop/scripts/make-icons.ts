import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";

const brand = resolve(import.meta.dir, "../../brand/logo");
const iconsDir = resolve(import.meta.dir, "../src-tauri/icons");
const svg16Path = resolve(brand, "favicon-agent-bg-16.svg");
const svg32Path = resolve(brand, "favicon-agent-bg-32.svg");

/** Apple macOS app-icon grid: 100pt margin on a 1024pt canvas. */
const DOCK_MARGIN = 100 / 1024;

function innerMarkup(svg: string): string {
	return svg.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "").trim();
}

function dockSvg(inner: string, view: number, canvas: number): string {
	const inset = Math.round(canvas * DOCK_MARGIN);
	const size = canvas - inset * 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}" fill="none">
<svg x="${inset}" y="${inset}" width="${size}" height="${size}" viewBox="0 0 ${view} ${view}">${inner}</svg>
</svg>`;
}

function pngFromSvg(svg: string, size: number): Buffer {
	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: size },
		background: "transparent",
	});
	return Buffer.from(resvg.render().asPng());
}

function pngIco(images: Array<{ width: number; png: Buffer }>): Buffer {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	const entries = Buffer.alloc(16 * images.length);
	const blobs: Buffer[] = [header, entries];
	let offset = 6 + entries.length;
	images.forEach((image, index) => {
		const at = index * 16;
		entries.writeUInt8(image.width >= 256 ? 0 : image.width, at);
		entries.writeUInt8(image.width >= 256 ? 0 : image.width, at + 1);
		entries.writeUInt8(0, at + 2);
		entries.writeUInt8(0, at + 3);
		entries.writeUInt16LE(1, at + 4);
		entries.writeUInt16LE(32, at + 6);
		entries.writeUInt32LE(image.png.byteLength, at + 8);
		entries.writeUInt32LE(offset, at + 12);
		blobs.push(image.png);
		offset += image.png.byteLength;
	});
	return Buffer.concat(blobs);
}

async function main(): Promise<void> {
	const svg16 = await Bun.file(svg16Path).text();
	const svg32 = await Bun.file(svg32Path).text();
	const mark32 = innerMarkup(svg32);
	await mkdir(iconsDir, { recursive: true });
	await writeFile(resolve(iconsDir, "icon.svg"), svg32);
	await writeFile(resolve(iconsDir, "icon.png"), pngFromSvg(dockSvg(mark32, 32, 512), 512));
	await writeFile(resolve(iconsDir, "icon-1024.png"), pngFromSvg(dockSvg(mark32, 32, 1024), 1024));
	const png16 = pngFromSvg(svg16, 16);
	const png32 = pngFromSvg(svg32, 32);
	await writeFile(resolve(iconsDir, "16x16.png"), png16);
	await writeFile(resolve(iconsDir, "32x32.png"), png32);
	await writeFile(resolve(iconsDir, "128x128.png"), pngFromSvg(dockSvg(mark32, 32, 128), 128));
	await writeFile(resolve(iconsDir, "henry.w@example.net"), pngFromSvg(dockSvg(mark32, 32, 256), 256));
	const iconset = resolve(iconsDir, "icon.iconset");
	await mkdir(iconset, { recursive: true });
	const sizes: Array<[string, string, number]> = [
		["icon_16x16.png", svg16, 16],
		["icon_16x16@2x.png", svg16, 32],
		["icon_32x32.png", dockSvg(mark32, 32, 32), 32],
		["icon_32x32@2x.png", dockSvg(mark32, 32, 64), 64],
		["icon_128x128.png", dockSvg(mark32, 32, 128), 128],
		["icon_128x128@2x.png", dockSvg(mark32, 32, 256), 256],
		["icon_256x256.png", dockSvg(mark32, 32, 256), 256],
		["icon_256x256@2x.png", dockSvg(mark32, 32, 512), 512],
		["icon_512x512.png", dockSvg(mark32, 32, 512), 512],
		["icon_512x512@2x.png", dockSvg(mark32, 32, 1024), 1024],
	];
	for (const [name, svg, size] of sizes) {
		await writeFile(resolve(iconset, name), pngFromSvg(svg, size));
	}
	const icns = spawnSync("iconutil", ["-c", "icns", iconset, "-o", resolve(iconsDir, "icon.icns")], {
		encoding: "utf8",
	});
	if (icns.status !== 0) {
		throw new Error(icns.stderr || "iconutil could not write icon.icns");
	}
	await writeFile(
		resolve(iconsDir, "icon.ico"),
		pngIco([
			{ width: 16, png: png16 },
			{ width: 32, png: png32 },
		]),
	);
	console.log(`Wrote dock icons with macOS grid inset from ${svg32Path}`);
}

await main();
