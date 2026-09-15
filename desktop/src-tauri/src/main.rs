#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};

mod mic;

use mic::{mic_start, mic_stop, MicState};

#[cfg(target_os = "macos")]
fn apply_process_name() {
    use objc2_foundation::{ns_string, NSProcessInfo};
    NSProcessInfo::processInfo().setProcessName(ns_string!("Caelence agent"));
}

#[derive(Clone, serde::Serialize)]
struct BridgeInfo {
    url: String,
    token: String,
}

struct BridgeProcess(Mutex<Option<Child>>);

fn bun_bin() -> PathBuf {
    if let Ok(path) = std::env::var("BUN_PATH") {
        return PathBuf::from(path);
    }
    if let Some(path) = which("bun") {
        return path;
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    for candidate in [
        PathBuf::from("/usr/local/bin/bun"),
        PathBuf::from("/opt/homebrew/bin/bun"),
        home.join(".bun/bin/bun"),
    ] {
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from("bun")
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(name);
        candidate.is_file().then_some(candidate)
    })
}

fn host_cwd() -> PathBuf {
    if let Ok(value) = std::env::var("HARNESS_CWD") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.file_name().and_then(|name| name.to_str()) == Some("desktop") {
        if let Some(harness) = cwd.parent() {
            if harness.file_name().and_then(|name| name.to_str()) == Some("harness") {
                if let Some(root) = harness.parent() {
                    return root.to_path_buf();
                }
            }
        }
    }
    cwd
}

fn bridge_script() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/desktop/bridge.ts")
}

fn spawn_bridge() -> Result<(Child, BridgeInfo), String> {
    let bun = bun_bin();
    let script = bridge_script();
    if !script.is_file() {
        return Err(format!(
            "Bridge script is missing at {}. Reinstall @useavalon/caelence-agent.",
            script.display()
        ));
    }
    let cwd = host_cwd();
    let mut child = Command::new(&bun)
        .arg(&script)
        .current_dir(&cwd)
        .env("HARNESS_CWD", &cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| {
            format!(
                "Could not start bun at {}. Is bun installed? {err}",
                bun.display()
            )
        })?;
    let stdout = child.stdout.take().ok_or("Caelence agent stdout is missing.")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .map_err(|err| format!("Caelence agent closed: {err}"))?;
        if n == 0 {
            return Err("Caelence agent exited before it was ready.".into());
        }
        if let Some(raw) = line.trim().strip_prefix("HARNESS_READY=") {
            let ready: serde_json::Value = serde_json::from_str(raw)
                .map_err(|err| format!("Caelence agent ready line is invalid: {err}"))?;
            let url = ready
                .get("url")
                .and_then(|value| value.as_str())
                .ok_or("Caelence agent url is missing.")?
                .to_string();
            let token = ready
                .get("token")
                .and_then(|value| value.as_str())
                .ok_or("Caelence agent token is missing.")?
                .to_string();
            std::thread::spawn(move || {
                let mut rest = String::new();
                while reader.read_line(&mut rest).ok().unwrap_or(0) > 0 {
                    rest.clear();
                }
            });
            return Ok((child, BridgeInfo { url, token }));
        }
    }
}

#[tauri::command]
fn bridge_info(info: State<BridgeInfo>) -> BridgeInfo {
    info.inner().clone()
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http and https links can open.".into());
    }
    spawn_open(vec![url], false)
}

#[tauri::command]
fn open_path(path: String, reveal: Option<bool>) -> Result<(), String> {
    let abs = expand_user_path(&path)?;
    spawn_open(vec![abs.to_string_lossy().into_owned()], reveal.unwrap_or(false))
}

fn expand_user_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains('\0') || trimmed.contains('\n') {
        return Err("Path is missing.".into());
    }
    let stripped = if let Some(rest) = trimmed.strip_prefix("file://") {
        rest.split('?').next().unwrap_or(rest).replace("%20", " ")
    } else {
        trimmed.to_string()
    };
    let path = if stripped == "~" {
        PathBuf::from(std::env::var("HOME").map_err(|_| "Home folder is missing.")?)
    } else if let Some(rest) = stripped.strip_prefix("~/") {
        PathBuf::from(std::env::var("HOME").map_err(|_| "Home folder is missing.")?).join(rest)
    } else {
        PathBuf::from(&stripped)
    };
    if !path.exists() {
        return Err("File is missing.".into());
    }
    Ok(path)
}

fn spawn_open(args: Vec<String>, reveal: bool) -> Result<(), String> {
    let mut command = if cfg!(target_os = "macos") {
        let mut cmd = Command::new("/usr/bin/open");
        if reveal {
            cmd.arg("-R");
        }
        cmd.args(&args);
        cmd
    } else if cfg!(target_os = "windows") {
        if reveal {
            let mut cmd = Command::new("explorer");
            cmd.arg("/select,");
            cmd.args(&args);
            cmd
        } else {
            let mut cmd = Command::new("cmd");
            cmd.args(["/c", "start", ""]);
            cmd.args(&args);
            cmd
        }
    } else {
        let mut cmd = Command::new("xdg-open");
        if reveal {
            if let Some(first) = args.first() {
                let path = PathBuf::from(first);
                if let Some(parent) = path.parent() {
                    cmd.arg(parent);
                } else {
                    cmd.args(&args);
                }
            } else {
                cmd.args(&args);
            }
        } else {
            cmd.args(&args);
        }
        cmd
    };
    command
        .spawn()
        .map_err(|err| format!("Could not open: {err}"))?;
    Ok(())
}

fn main() {
    #[cfg(target_os = "macos")]
    apply_process_name();

    let (child, info) = match spawn_bridge() {
        Ok(ready) => ready,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(info)
        .manage(BridgeProcess(Mutex::new(Some(child))))
        .manage(MicState::default())
        .invoke_handler(tauri::generate_handler![bridge_info, open_url, open_path, mic_start, mic_stop])
        .build(tauri::generate_context!())
        .expect("error while building Harness")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<BridgeProcess>() {
                    if let Ok(mut child) = state.0.lock() {
                        if let Some(mut process) = child.take() {
                            let _ = process.kill();
                        }
                    }
                }
            }
        });
}
