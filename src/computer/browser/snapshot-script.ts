/** Injected into the page. Returns { header, lines, boxes }. */

export const PAGE_SNAPSHOT_SOURCE = `(() => {
  const INTERACTIVE = new Set([
    "A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "SUMMARY", "OPTION",
  ]);
  const ROLES = new Set([
    "button", "link", "textbox", "tab", "menuitem", "option", "checkbox",
    "combobox", "switch", "searchbox", "radio", "slider",
  ]);

  function visible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    return true;
  }

  function roleOf(el) {
    const explicit = (el.getAttribute("role") || "").toLowerCase();
    if (ROLES.has(explicit)) return explicit;
    const tag = el.tagName;
    if (tag === "A") return "link";
    if (tag === "BUTTON") return "button";
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    if (el.tabIndex >= 0) return "button";
    return "";
  }

  function nameOf(el) {
    const bits = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("placeholder"),
      el.getAttribute("alt"),
      el.value,
      el.innerText,
    ];
    for (const bit of bits) {
      const text = String(bit || "").replace(/\\s+/g, " ").trim();
      if (text) return text.slice(0, 70);
    }
    return "";
  }

  function flagsOf(el) {
    const flags = [];
    if (el.disabled) flags.push("disabled");
    if (el === document.activeElement) flags.push("focused");
    if (el.getAttribute("aria-expanded") === "true") flags.push("expanded");
    if (el.checked || el.getAttribute("aria-checked") === "true") flags.push("checked");
    return flags;
  }

  function walk(root, prefix, acc) {
    const nodes = root.querySelectorAll("*");
    for (const el of nodes) {
      if (el.shadowRoot) walk(el.shadowRoot, prefix, acc);
      const role = roleOf(el);
      if (!role && !INTERACTIVE.has(el.tagName) && !el.isContentEditable) continue;
      if (!visible(el)) continue;
      const usedRole = role || "button";
      acc.push({ el, role: usedRole, name: nameOf(el), flags: flagsOf(el), prefix });
    }
  }

  const collected = [];
  walk(document, "", collected);
  const frames = document.querySelectorAll("iframe");
  frames.forEach((frame, i) => {
    try {
      const doc = frame.contentDocument;
      if (doc) walk(doc, "f" + (i + 1) + ":", collected);
    } catch (_) {}
  });

  document.querySelectorAll("[data-ag]").forEach((el) => el.removeAttribute("data-ag"));
  const lines = [];
  const boxes = [];
  collected.slice(0, 250).forEach((item, i) => {
    const ref = item.prefix + String(i + 1);
    item.el.setAttribute("data-ag", ref);
    const flag = item.flags.length ? " [" + item.flags.join(",") + "]" : "";
    const name = JSON.stringify(item.name || usedName(item));
    lines.push(ref + " " + item.role + " " + name + flag);
    const r = item.el.getBoundingClientRect();
    boxes.push({ ref, x: r.x, y: r.y, w: r.width, h: r.height });
  });
  function usedName(item) { return item.name || item.role; }

  const modal = document.querySelector("[role='dialog'], dialog[open]");
  const headings = Array.from(document.querySelectorAll("h1,h2"))
    .slice(0, 6)
    .map((h) => h.innerText.replace(/\\s+/g, " ").trim())
    .filter(Boolean);
  const header = [
    "URL " + location.href,
    "TITLE " + document.title,
    headings.length ? "HEADINGS " + headings.join(" | ") : "",
    modal ? "MODAL OPEN" : "",
  ].filter(Boolean).join("\\n");
  return { header, lines, boxes };
})()`;
