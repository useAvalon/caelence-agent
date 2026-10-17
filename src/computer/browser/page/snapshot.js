const INTERACTIVE = [
	"a[href]",
	"button",
	"input:not([type=hidden])",
	"textarea",
	"select",
	"summary",
	"[contenteditable='']",
	"[contenteditable='true']",
	"[contenteditable='plaintext-only']",
	"[role=button]",
	"[role=link]",
	"[role=textbox]",
	"[role=tab]",
	"[role=menuitem]",
	"[role=option]",
	"[role=checkbox]",
	"[role=radio]",
	"[role=combobox]",
	"[role=switch]",
].join(",");
const MODAL = "dialog[open], [role=dialog], [role=alertdialog], [aria-modal='true']";

function parentOf(node) {
	if (!node) return null;
	return node.parentNode || node.host || null;
}

function composedContains(ancestor, node) {
	for (let current = node; current; current = parentOf(current)) {
		if (current === ancestor) return true;
	}
	return false;
}

function* deepAll(rootNode, selector) {
	const list = rootNode.querySelectorAll ? rootNode.querySelectorAll("*") : [];
	for (const el of list) {
		if (el.matches && el.matches(selector)) yield el;
		if (el.shadowRoot) yield* deepAll(el.shadowRoot, selector);
	}
}

function deepActive() {
	let active = document.activeElement;
	while (active && active.shadowRoot && active.shadowRoot.activeElement) {
		active = active.shadowRoot.activeElement;
	}
	return active;
}

function visible(el) {
	const rect = el.getBoundingClientRect();
	if (rect.width < 2 || rect.height < 2) return false;
	if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
		return false;
	}
	const style = getComputedStyle(el);
	return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
}

function blocked(el) {
	for (let node = el; node; node = parentOf(node)) {
		if (!node || node.nodeType !== 1) continue;
		if (node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return true;
	}
	return false;
}

function topAt(x, y) {
	let hit = document.elementFromPoint(x, y);
	while (hit && hit.shadowRoot) {
		const inner = hit.shadowRoot.elementFromPoint(x, y);
		if (!inner || inner === hit) break;
		hit = inner;
	}
	return hit;
}

function hittable(el) {
	const rect = el.getBoundingClientRect();
	const x = rect.left + rect.width / 2;
	const y = rect.top + rect.height / 2;
	const hit = topAt(x, y);
	if (!hit) return false;
	if (hit.control === el) return true;
	return composedContains(el, hit);
}

function textById(el, id) {
	const rootNode = el.getRootNode();
	const found =
		(rootNode.getElementById ? rootNode.getElementById(id) : null) || document.getElementById(id);
	return found ? found.textContent : "";
}

function accName(el) {
	const labelledBy = el.getAttribute("aria-labelledby");
	let labelText = "";
	try {
		if (el.labels && el.labels[0]) labelText = el.labels[0].textContent || "";
	} catch (_err) {
		labelText = "";
	}
	const candidates = [
		el.getAttribute("aria-label"),
		labelledBy
			? labelledBy
					.split(/\s+/)
					.map((id) => textById(el, id))
					.join(" ")
			: "",
		el.getAttribute("aria-placeholder"),
		el.getAttribute("data-placeholder"),
		el.getAttribute("placeholder"),
		el.getAttribute("title"),
		labelText,
		el.innerText,
		el.value,
	];
	const name = candidates.find((item) => item && String(item).trim()) || "";
	return String(name).trim().replace(/\s+/g, " ").slice(0, 70);
}

function roleOf(el) {
	if (el.isContentEditable) return "textbox";
	const explicit = el.getAttribute("role");
	if (explicit) return explicit;
	const tag = el.tagName.toLowerCase();
	if (tag === "a") return "link";
	if (tag === "input") return ["checkbox", "radio"].includes(el.type) ? el.type : "textbox";
	if (tag === "textarea") return "textbox";
	if (tag === "select") return "combobox";
	if (tag === "button") return "button";
	return tag;
}

function fieldText(el) {
	if (el.isContentEditable) return el.innerText || "";
	return el.value || "";
}

function topModal() {
	const semantic = [...deepAll(document, MODAL)].filter((el) => {
		const rect = el.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return false;
		const style = getComputedStyle(el);
		return style.display !== "none" && style.visibility !== "hidden";
	});
	if (semantic.length) return semantic[semantic.length - 1];
	const hit = topAt(innerWidth / 2, innerHeight / 2);
	let best = null;
	for (let node = hit; node; node = parentOf(node)) {
		if (!node || node.nodeType !== 1) continue;
		const style = getComputedStyle(node);
		const z = Number(style.zIndex);
		const raised = style.position === "fixed" || style.position === "sticky" || z > 10;
		if (!raised) continue;
		const rect = node.getBoundingClientRect();
		if (rect.width < innerWidth * 0.28 || rect.height < 80) continue;
		let interactive = false;
		for (const el of deepAll(node, INTERACTIVE)) {
			if (visible(el)) {
				interactive = true;
				break;
			}
		}
		if (interactive) best = node;
	}
	return best;
}

function collectInteractive() {
	const scope = topModal();
	const active = deepActive();
	const items = [];
	const skipped = [];
	const note = (el, reason) => {
		if (!window.__agDebug || reason === "outside-modal" || skipped.length >= 30) return;
		skipped.push({ reason, role: roleOf(el), name: accName(el).slice(0, 40) });
	};
	for (const el of deepAll(document, INTERACTIVE)) {
		if (scope && !composedContains(scope, el)) {
			note(el, "outside-modal");
			continue;
		}
		if (!visible(el)) {
			note(el, "invisible");
			continue;
		}
		if (blocked(el)) {
			note(el, "hidden");
			continue;
		}
		const role = roleOf(el);
		const canHit = hittable(el);
		if (!canHit && role !== "textbox") {
			note(el, "covered");
			continue;
		}
		const name = accName(el);
		const flags = [];
		if (el.disabled || el.getAttribute("aria-disabled") === "true") flags.push("disabled");
		if (el.getAttribute("aria-expanded") === "true") flags.push("expanded");
		if (el.checked) flags.push("checked");
		if (active && composedContains(el, active)) flags.push("focused");
		if (role === "textbox" && !fieldText(el).trim()) flags.push("empty");
		if (!canHit) flags.push("covered");
		items.push({ el, role, name, flags });
	}
	return { items: items.slice(0, 250), scope, active, skipped };
}

function publishRefs(items) {
	const refs = new Map();
	const meta = {};
	items.forEach((item, index) => {
		const ref = String(index + 1);
		refs.set(ref, item.el);
		meta[ref] = { role: item.role, name: item.name };
		item.ref = ref;
	});
	window.__agRefs = refs;
	window.__agMeta = meta;
	return meta;
}

window.__agSnap = () => {
	window.__agDebug = true;
	const { items, scope, skipped } = collectInteractive();
	const meta = publishRefs(items);
	const lines = items.map((item) => {
		const flag = item.flags.length ? ` (${item.flags.join(", ")})` : "";
		return `[${item.ref}] ${item.role} ${JSON.stringify(item.name)}${flag}`;
	});
	const header = [`URL: ${location.href}`, `TITLE: ${document.title}`];
	if (scope) {
		header.push(
			`MODAL OPEN: ${JSON.stringify(accName(scope) || "dialog")}. Only modal contents are listed; the page behind is blocked.`,
		);
	}
	const active = deepActive();
	return {
		text: [...header, ...lines].join("\n"),
		meta,
		count: items.length,
		modal: Boolean(scope),
		url: location.href,
		focused: items.some((item) => item.flags.includes("focused") || (active && item.el === active)),
		skipped,
	};
};

function resolveTarget(target) {
	const ref = target && target.ref ? String(target.ref).replace(/^\[|\]$/g, "") : "";
	if (ref) {
		const live = window.__agRefs && window.__agRefs.get(ref);
		if (live && live.isConnected) return live;
		const saved = window.__agMeta && window.__agMeta[ref];
		if (saved) return findByRole(saved.role, saved.name);
		return null;
	}
	if (target && target.role && target.name) return findByRole(target.role, target.name);
	return null;
}

function findByRole(role, name) {
	const want = String(name || "").trim().toLowerCase();
	if (!want) return null;
	let found = null;
	for (const item of collectInteractive().items) {
		if (item.role !== role) continue;
		const have = item.name.toLowerCase();
		if (have.includes(want)) found = item.el;
	}
	return found;
}

function focusInside(el) {
	let active = deepActive();
	for (let node = active; node; node = parentOf(node)) {
		if (node === el) return true;
	}
	return false;
}

function readEl(el) {
	return fieldText(el);
}

function normText(value) {
	return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
