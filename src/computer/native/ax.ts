import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const AX_SNAPSHOT = `
ObjC.import("AppKit");
ObjC.import("ApplicationServices");
function attr(el, name) {
  const out = $();
  if ($.AXUIElementCopyAttributeValue(el, name, out) !== 0) return null;
  return out[0];
}
function run(argv) {
  const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!app) return "NO APP";
  const pid = app.processIdentifier;
  const root = $.AXUIElementCreateApplication(pid);
  const window = attr(root, $("AXFocusedWindow")) || (attr(root, $("AXWindows")) || [])[0];
  if (!window) return "Frontmost app: " + app.localizedName.js + "\\n(no window)";
  const lines = ["Frontmost app: " + app.localizedName.js];
  const queue = [window];
  let n = 0;
  const deadline = Date.now() + 450;
  while (queue.length && n < 140 && Date.now() < deadline) {
    const el = queue.shift();
    const role = String(attr(el, $("AXRole")) || "");
    const title = String(attr(el, $("AXTitle")) || attr(el, $("AXDescription")) || attr(el, $("AXValue")) || "");
    const pressable = role.indexOf("Button") >= 0 || role.indexOf("Link") >= 0 || role.indexOf("Menu") >= 0 || role.indexOf("Check") >= 0 || role.indexOf("Tab") >= 0;
    const field = role.indexOf("Text") >= 0 || role.indexOf("Search") >= 0;
    if (pressable || field) {
      n += 1;
      const kind = field ? "textbox" : "button";
      lines.push("n" + n + " " + kind + " " + JSON.stringify(String(title).slice(0, 70)));
    }
    const kids = attr(el, $("AXChildren")) || [];
    for (let i = 0; i < Math.min(kids.length, 80); i++) queue.push(kids[i]);
  }
  return lines.join("\\n");
}
`;

export async function nativeAxSnapshot(): Promise<string> {
	try {
		const { stdout } = await execFileAsync(
			"/usr/bin/osascript",
			["-l", "JavaScript", "-e", AX_SNAPSHOT],
			{
				timeout: 4_000,
			},
		);
		return stdout.trim();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/not allowed|assistive|accessibility/i.test(message)) {
			return "Accessibility permission is off. Allow Caelence under Privacy & Security.";
		}
		throw err;
	}
}
