/** Removes a leftover in-page cursor from an earlier run. The live cursor is the OS overlay. */
export const OVERLAY_REMOVE_SOURCE = `(() => {
  const root = document.getElementById("caelence-agent-overlay");
  if (root) root.remove();
  try { delete window.__caelenceOverlay; } catch (_) {}
  return "removed";
})()`;

export const SETTLE_SOURCE = `(() => new Promise((resolve) => {
  let timer;
  const done = () => { observer.disconnect(); resolve("settled"); };
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(done, 80);
  };
  const observer = new MutationObserver(bump);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bump, { once: true });
  } else {
    bump();
  }
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  setTimeout(done, 400);
}))()`;

export const OPEN_COMPOSER_SOURCE = `(() => {
  const nameOf = (el) =>
    ((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "")).replace(/\\s+/g, " ").trim().toLowerCase();
  const shortText = (el) => {
    const text = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
    return text.length <= 32 ? text : "";
  };
  const hrefOf = (el) => {
    const a = el.closest ? el.closest("a") : el;
    return String((a && a.getAttribute && a.getAttribute("href")) || "").toLowerCase();
  };
  const inFeed = (el) => Boolean(el.closest && el.closest("article, [role=article]"));
  const looksCompose = (label) => {
    if (!label || label.length > 32) return false;
    if (/repost|follow|profile|reply|comment/.test(label)) return false;
    if (label === "post" || label === "new post" || label === "compose") return true;
    return /start a post|share an update|create a post|what's happening|what is happening/.test(label);
  };
  const nodes = [...document.querySelectorAll("a, button, [role=button]")].filter((el) => !inFeed(el));
  const hit =
    nodes.find((el) => /\\/compose/.test(hrefOf(el))) ||
    nodes.find((el) => looksCompose(nameOf(el)) || looksCompose(shortText(el)));
  if (hit) { hit.click(); return "clicked"; }
  const dialog = document.querySelector("[role=dialog] [contenteditable=true], [role=dialog] textarea, [role=dialog] [role=textbox]");
  if (dialog) { dialog.focus(); dialog.click(); return "focused"; }
  return "none";
})()`;

export function typeActiveSource(text: string): string {
	return `(() => {
  const el = document.querySelector("[contenteditable=true], .ql-editor, textarea, [role=textbox]");
  if (!el) return { ok: false };
  el.focus();
  el.click();
  const value = ${JSON.stringify(text)};
  if ("value" in el) {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  const inserted = document.execCommand("insertText", false, value);
  if (!inserted) el.textContent = value;
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  return { ok: true };
})()`;
}
