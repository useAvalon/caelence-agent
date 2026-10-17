function measureOf(target, scroll) {
	const el = resolveTarget(target);
	if (!el || !el.isConnected) {
		return { ok: false, code: "stale", message: "The ref is gone. Use a role and name, or a ref from the snapshot." };
	}
	if (scroll) el.scrollIntoView({ block: "center", inline: "nearest" });
	const rect = el.getBoundingClientRect();
	const chrome = Math.max(0, window.outerHeight - window.innerHeight);
	const side = Math.max(0, window.outerWidth - window.innerWidth);
	return {
		ok: rect.width > 1 && rect.height > 1,
		code: rect.width > 1 && rect.height > 1 ? undefined : "missing",
		message: rect.width > 1 ? undefined : "Target has no size yet.",
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
		screenX: Math.round(window.screenX + side / 2 + rect.left + rect.width / 2),
		screenY: Math.round(window.screenY + chrome + rect.top + rect.height / 2),
		role: roleOf(el),
		name: accName(el),
		hittable: hittable(el),
		focused: focusInside(el),
	};
}

function ancestorRole(el, role) {
	for (let node = el; node; node = parentOf(node)) {
		if (node.nodeType === 1 && node.getAttribute && node.getAttribute("role") === role) return node;
	}
	return null;
}

window.__agOps = {
	snap() {
		return window.__agSnap();
	},
	measure(target, scroll) {
		return measureOf(target, scroll !== false);
	},
	clickElement(target) {
		const el = resolveTarget(target);
		if (!el || !el.isConnected) return { ok: false, code: "stale" };
		if (!hittable(el)) return { ok: false, code: "covered" };
		el.click();
		return { ok: true, method: "click" };
	},
	dismissBlockers() {
		let clicks = 0;
		for (const el of deepAll(document, "button, [role=button]")) {
			const name = accName(el);
			if (!/dismiss|close|accept|got it|luk|^ok$/i.test(name)) continue;
			if (!visible(el) || !hittable(el)) continue;
			const toast = ancestorRole(el, "status") || ancestorRole(el, "alert");
			if (!toast && !/accept|got it|luk/i.test(name)) continue;
			el.click();
			clicks += 1;
			break;
		}
		return clicks;
	},
	focusState(target) {
		const el = resolveTarget(target);
		if (!el) return { inside: false, code: "stale" };
		return { inside: focusInside(el) };
	},
	focus(target) {
		const el = resolveTarget(target);
		if (!el) return { ok: false, code: "stale" };
		el.focus();
		return { ok: focusInside(el) };
	},
	clear(target) {
		const el = resolveTarget(target);
		if (!el) return { ok: false, code: "stale" };
		if (!focusInside(el)) return { ok: false, code: "focus" };
		if (!normText(readEl(el))) return { ok: true, skipped: true };
		if (el.isContentEditable) {
			const range = document.createRange();
			range.selectNodeContents(el);
			const rootNode = el.getRootNode();
			const selection = (rootNode.getSelection && rootNode.getSelection()) || window.getSelection();
			if (selection) {
				selection.removeAllRanges();
				selection.addRange(range);
			}
			document.execCommand("delete");
		} else if ("value" in el) {
			el.value = "";
			el.dispatchEvent(new Event("input", { bubbles: true }));
		}
		return { ok: true };
	},
	read(target) {
		const el = resolveTarget(target);
		return el ? readEl(el) : "";
	},
	insert(target, text) {
		const el = resolveTarget(target);
		if (!el) return { ok: false, code: "stale" };
		el.focus();
		if (el.isContentEditable || el.getAttribute("role") === "textbox") {
			document.execCommand("insertText", false, text);
			return { ok: true };
		}
		if ("value" in el) {
			el.value = `${el.value || ""}${text}`;
			el.dispatchEvent(new Event("input", { bubbles: true }));
			return { ok: true };
		}
		return { ok: false, code: "missing" };
	},
	typeahead() {
		for (const el of deepAll(document, "[role=listbox]")) {
			if (visible(el)) return true;
		}
		return false;
	},
	modalCount() {
		let count = 0;
		for (const el of deepAll(document, "dialog[open], [role=dialog], [role=alertdialog]")) {
			if (visible(el) || (el.tagName === "DIALOG" && el.hasAttribute("open"))) count += 1;
		}
		return count;
	},
	finishMotion() {
		const list = document.getAnimations ? document.getAnimations({ subtree: true }) : [];
		for (const anim of list) {
			try {
				const timing = anim.effect && anim.effect.getTiming ? anim.effect.getTiming() : null;
				const duration = timing ? Number(timing.duration) : 0;
				if (duration > 0 && duration <= 1000 && anim.playState !== "finished") anim.finish();
			} catch (_err) {
				/* A custom animation can refuse finish(). */
			}
		}
	},
	diagnostics(target) {
		const overlay = window.__ag.health();
		const el = target ? resolveTarget(target) : null;
		let topAtTarget = null;
		if (el) {
			const rect = el.getBoundingClientRect();
			const hit = topAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
			topAtTarget = hit ? String(hit.outerHTML || hit.tagName).slice(0, 300) : null;
		}
		return {
			overlay,
			nativeTopLayerDialog: Boolean(document.querySelector("dialog[open]")),
			ariaModal: Boolean(document.querySelector("[role=dialog], [aria-modal='true']")),
			targetConnected: el ? el.isConnected : null,
			topAtTarget,
		};
	},
};
