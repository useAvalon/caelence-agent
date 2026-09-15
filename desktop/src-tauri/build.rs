fn main() {
	// generate_context! embeds these at compile time; tauri-build's icon
	// rerun-if-changed only fires with the codegen feature, which we do not use.
	for icon in [
		"icons/icon.png",
		"icons/16x16.png",
		"icons/32x32.png",
		"icons/128x128.png",
		"icons/henry.w@example.net",
		"icons/icon.icns",
		"icons/icon.ico",
	] {
		println!("cargo:rerun-if-changed={icon}");
	}
	tauri_build::build()
}
