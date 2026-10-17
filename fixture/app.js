class PostEditor extends HTMLElement {
	constructor() {
		super();
		const root = this.attachShadow({ mode: "open" });
		const ed = document.createElement("div");
		ed.contentEditable = "true";
		ed.setAttribute("role", "textbox");
		ed.setAttribute("aria-label", "Text editor for creating content");
		ed.setAttribute("data-placeholder", "What do you want to talk about?");
		ed.className = "editor";
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(".editor{min-height:120px;padding:8px;border:1px solid #ccc;margin-top:48px}");
		root.adoptedStyleSheets = [sheet];
		root.append(ed);

		ed.addEventListener("input", () => {
			const open = /#\w*$/.test(ed.innerText);
			let list = root.querySelector("[role=listbox]");
			if (open && !list) {
				list = document.createElement("ul");
				list.setAttribute("role", "listbox");
				const li = document.createElement("li");
				li.setAttribute("role", "option");
				li.textContent = "#suggestion";
				list.append(li);
				root.append(list);
			} else if (!open && list) list.remove();
		});
		ed.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && root.querySelector("[role=listbox]")) {
				event.stopPropagation();
				event.preventDefault();
				root.querySelector("[role=listbox]")?.remove();
			}
		});
	}
}
customElements.define("post-editor", PostEditor);

const dialog = document.getElementById("composer");
document.getElementById("start")?.addEventListener("click", () => {
	if (!(dialog instanceof HTMLDialogElement)) return;
	dialog.showModal();
	dialog.animate(
		[
			{ transform: "translateY(40px)", opacity: 0 },
			{ transform: "none", opacity: 1 },
		],
		{ duration: 300 },
	);
	setTimeout(() => {
		const toast = document.getElementById("toast");
		if (!toast) return;
		toast.hidden = false;
		dialog.append(toast);
	}, 1000);
});
document.querySelector("#toast button")?.addEventListener("click", () => {
	const toast = document.getElementById("toast");
	if (toast) toast.hidden = true;
});
