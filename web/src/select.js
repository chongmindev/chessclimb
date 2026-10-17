// A custom dropdown drawn over a hidden native <select>, which stays the source of truth: options are read
// from it, and choosing one sets its value and fires "change". So code that reads the <select> keeps working.
// ARIA: a button (aria-haspopup="listbox") that opens a listbox of options; keyboard as in a native select.
// <option data-icon="i-name"> puts that sprite symbol before the option's text; <select data-compact> shows only
// the chosen option's icon on the button (its text stays there for screen readers).

const SVG = "http://www.w3.org/2000/svg";
function icon(id) {
  const svg = document.createElementNS(SVG, "svg"), use = document.createElementNS(SVG, "use");
  svg.setAttribute("class", "logo");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

export class Select {
  constructor(select) {
    this.select = select;
    this.root = document.createElement("div");
    this.root.className = "dropdown" + ("compact" in select.dataset ? " compact" : "");
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "dropdown-button input";
    this.button.setAttribute("aria-haspopup", "listbox");
    this.button.setAttribute("aria-expanded", "false");
    const labelledBy = select.closest("label")?.querySelector(".label");
    if (labelledBy) {
      labelledBy.id ||= `${select.id}-label`;
      this.button.setAttribute("aria-labelledby", `${labelledBy.id} ${select.id}-value`);
    }
    this.value = document.createElement("span");
    this.value.id = `${select.id}-value`;
    this.button.append(this.value);
    this.list = document.createElement("ul");
    this.list.className = "dropdown-list";
    this.list.setAttribute("role", "listbox");
    this.list.id = `${select.id}-list`;
    this.list.tabIndex = -1;
    this.list.hidden = true;
    this.button.setAttribute("aria-controls", this.list.id);
    this.build();
    this.root.append(this.button, this.list);
    select.hidden = true;
    select.after(this.root);
    // The native select can't be focused while hidden; send label clicks to the button instead.
    select.closest("label")?.addEventListener("click", (e) => { if (!this.root.contains(e.target)) { e.preventDefault(); this.button.focus(); } });

    this.button.addEventListener("click", () => (this.isOpen() ? this.close() : this.open()));
    this.button.addEventListener("keydown", (e) => this.onButtonKey(e));
    this.list.addEventListener("keydown", (e) => this.onListKey(e));
    this.list.addEventListener("click", (e) => { const li = e.target.closest("[role=option]"); if (li) this.choose(li.dataset.value); });
    this.list.addEventListener("mousemove", (e) => { const li = e.target.closest("[role=option]"); if (li) this.setActive(li); });
    document.addEventListener("pointerdown", (e) => { if (this.isOpen() && !this.root.contains(e.target)) this.close(false); });
    select.addEventListener("change", () => this.sync());
    this.sync();
  }

  /** One <li> per <option>; optgroups become non-selectable headings. */
  build() {
    this.list.replaceChildren();
    for (const node of this.select.children) {
      const opts = node.tagName === "OPTGROUP" ? [...node.children] : [node];
      if (node.tagName === "OPTGROUP") {
        const head = document.createElement("li");
        head.className = "dropdown-group";
        head.setAttribute("role", "presentation");
        head.textContent = node.label;
        this.list.append(head);
      }
      for (const o of opts) {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.id = `${this.select.id}-opt-${o.value}`;
        li.dataset.value = o.value;
        li.textContent = o.textContent;
        if (o.dataset.icon) li.prepend(icon(o.dataset.icon));
        this.list.append(li);
      }
    }
  }

  options() { return [...this.list.querySelectorAll("[role=option]")]; }
  isOpen() { return !this.list.hidden; }

  sync() {
    const v = this.select.value;
    const o = this.select.selectedOptions[0];
    this.value.textContent = o?.textContent ?? "";
    if (o?.dataset.icon) {
      this.value.prepend(icon(o.dataset.icon));
      if (this.root.classList.contains("compact")) this.button.title = o.textContent;
    }
    for (const li of this.options()) li.setAttribute("aria-selected", String(li.dataset.value === v));
  }

  setActive(li) {
    for (const o of this.options()) o.classList.toggle("active", o === li);
    this.list.setAttribute("aria-activedescendant", li.id);
    li.scrollIntoView({ block: "nearest" });
  }

  open() {
    this.list.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.root.classList.add("open");
    this.setActive(this.options().find((o) => o.dataset.value === this.select.value) || this.options()[0]);
    this.list.focus();
  }

  close(refocus = true) {
    this.list.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.root.classList.remove("open");
    if (refocus) this.button.focus();
  }

  choose(value) {
    if (this.select.value !== value) {
      this.select.value = value;
      this.select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    this.sync();
    this.close();
  }

  onButtonKey(e) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); this.open(); }
  }

  onListKey(e) {
    const opts = this.options(), i = opts.findIndex((o) => o.classList.contains("active"));
    const go = (j) => { e.preventDefault(); this.setActive(opts[Math.max(0, Math.min(opts.length - 1, j))]); };
    switch (e.key) {
      case "ArrowDown": return go(i + 1);
      case "ArrowUp": return go(i - 1);
      case "Home": return go(0);
      case "End": return go(opts.length - 1);
      case "Enter": case " ": e.preventDefault(); return this.choose(opts[i].dataset.value);
      case "Escape": e.preventDefault(); return this.close();
      case "Tab": return this.close(false);
      default:
        if (e.key.length === 1) {   // type to jump to the next option starting with that character
          const k = e.key.toLowerCase();
          const next = [...opts.slice(i + 1), ...opts.slice(0, i + 1)].find((o) => o.textContent.trim().toLowerCase().startsWith(k));
          if (next) go(opts.indexOf(next));
        }
    }
  }
}
