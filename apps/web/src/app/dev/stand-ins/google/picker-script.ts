/**
 * The stand-in's `api.js`: just enough of `gapi.load("picker")` and
 * `google.picker` for useGooglePicker to run unchanged. It draws one tab per
 * view the app added, labelled by the filters the app set on it (so a
 * missing Shared with me or Shared drives tab shows), lists what Alex can
 * open, and on Select grants the picked ids the way Google's Picker does
 * under drive.file before calling back.
 *
 * Plain browser JavaScript in a string, styled with the app's own CSS
 * variables, because it runs inside the app page like Google's does.
 */

export function pickerScript(base: string): string {
    return `(() => {
  const BASE = ${JSON.stringify(base)};
  const FOLDER = "application/vnd.google-apps.folder";

  class DocsView {
    constructor() { this.ownedByMe = undefined; this.drives = false; }
    setIncludeFolders() { return this; }
    setSelectFolderEnabled() { return this; }
    setMimeTypes() { return this; }
    setParent(id) { this.parent = id; return this; }
    setOwnedByMe(value) { this.ownedByMe = value; return this; }
    setEnableDrives(value) { this.drives = value; return this; }
    get label() {
      if (this.drives) return "Shared drives";
      if (this.ownedByMe === false) return "Shared with me";
      if (this.ownedByMe === true) return "My Drive";
      return "Drive";
    }
    get kind() { return this.drives ? "drives" : this.ownedByMe === false ? "shared" : "all"; }
  }

  class PickerBuilder {
    constructor() { this.views = []; this.multi = false; this.title = "Select a file"; }
    addView(view) { this.views.push(view); return this; }
    setOAuthToken(token) { this.token = token; return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    setTitle(title) { this.title = title; return this; }
    enableFeature(feature) { if (feature === "multiselectEnabled") this.multi = true; return this; }
    setCallback(callback) { this.callback = callback; return this; }
    build() { const builder = this; return { setVisible(v) { if (v) open(builder); } }; }
  }

  function el(tag, style, text) {
    const node = document.createElement(tag);
    if (style) node.setAttribute("style", style);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function open(builder) {
    const views = builder.views.length ? builder.views : [new DocsView()];
    const picked = new Map();
    let view = views[0];
    let trail = [];

    const scrim = el("div", "position:fixed;inset:0;z-index:2147483000;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px;");
    scrim.setAttribute("data-stand-in-picker", "");
    const box = el("div", "width:min(640px,100%);max-height:min(560px,100%);display:flex;flex-direction:column;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-3);overflow:hidden;font:inherit;");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", builder.title);
    const head = el("div", "padding:14px 16px 0;");
    head.appendChild(el("div", "font-size:11px;color:var(--ink-3);margin-bottom:4px;", "Google Picker stand-in"));
    head.appendChild(el("div", "font-size:15px;font-weight:600;", builder.title));
    const tabs = el("div", "display:flex;gap:4px;padding:10px 12px 0;border-bottom:1px solid var(--line);");
    tabs.setAttribute("role", "tablist");
    const crumbs = el("div", "padding:8px 16px;font-size:12px;color:var(--ink-3);min-height:16px;");
    const list = el("div", "flex:1;overflow:auto;padding:4px 8px;");
    const foot = el("div", "display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:12px 16px;border-top:1px solid var(--line);");
    const count = el("span", "margin-right:auto;font-size:12px;color:var(--ink-3);", "");
    const cancel = el("button", "height:32px;padding:0 14px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;font:inherit;font-size:13px;", "Cancel");
    const select = el("button", "height:32px;padding:0 14px;border-radius:6px;border:none;background:var(--accent);color:var(--accent-fg);cursor:pointer;font:inherit;font-size:13px;font-weight:600;", "Select");
    foot.append(count, cancel, select);
    box.append(head, tabs, crumbs, list, foot);
    scrim.appendChild(box);
    document.body.appendChild(scrim);

    function close() { scrim.remove(); }
    function updateCount() {
      count.textContent = picked.size ? picked.size + " selected" : "";
      select.disabled = picked.size === 0;
      select.style.opacity = picked.size ? "1" : "0.5";
    }

    function drawTabs() {
      tabs.textContent = "";
      for (const v of views) {
        const active = v === view;
        const tab = el("button", "height:32px;padding:0 12px;border:none;border-bottom:2px solid " + (active ? "var(--accent)" : "transparent") + ";background:none;color:" + (active ? "var(--ink)" : "var(--ink-3)") + ";cursor:pointer;font:inherit;font-size:13px;font-weight:" + (active ? "600" : "400") + ";", v.label);
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(active));
        tab.onclick = () => { view = v; trail = []; drawTabs(); load(); };
        tabs.appendChild(tab);
      }
    }

    async function load() {
      const parent = trail.length ? trail[trail.length - 1].id : (view.parent || "");
      crumbs.textContent = [view.label].concat(trail.map(t => t.name)).join("  ›  ");
      if (trail.length) {
        const up = el("button", "margin-left:10px;border:none;background:none;color:var(--accent);cursor:pointer;font:inherit;font-size:12px;", "‹ Back");
        up.onclick = () => { trail.pop(); load(); };
        crumbs.appendChild(up);
      }
      list.textContent = "";
      list.appendChild(el("div", "padding:12px;font-size:13px;color:var(--ink-3);", "Loading…"));
      const res = await fetch(BASE + "/_standin/picker?view=" + view.kind + "&parent=" + encodeURIComponent(parent), { headers: { Authorization: "Bearer " + builder.token } });
      const body = res.ok ? await res.json() : { items: [] };
      list.textContent = "";
      if (!body.items.length) list.appendChild(el("div", "padding:12px;font-size:13px;color:var(--ink-3);", res.ok ? "Nothing here." : "The stand-in refused the token (HTTP " + res.status + ")."));
      for (const item of body.items) {
        const isFolder = item.mimeType === FOLDER;
        const row = el("label", "display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;cursor:pointer;font-size:13px;");
        const box = el("input");
        box.type = "checkbox";
        box.checked = picked.has(item.id);
        box.setAttribute("aria-label", "Select " + item.name);
        box.onchange = () => {
          if (box.checked) {
            if (!builder.multi) picked.clear();
            picked.set(item.id, item);
          } else picked.delete(item.id);
          if (!builder.multi) load();
          updateCount();
        };
        const name = el("span", "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", (isFolder ? "▸ " : "") + item.name);
        const owner = el("span", "font-size:11px;color:var(--ink-3);", item.owner === "me" ? "me" : item.owner);
        row.append(box, name, owner);
        if (isFolder) {
          const into = el("button", "border:1px solid var(--line);background:var(--panel-2);color:var(--ink-2);border-radius:6px;height:26px;padding:0 8px;cursor:pointer;font:inherit;font-size:12px;", "Open");
          into.onclick = event => { event.preventDefault(); trail.push({ id: item.id, name: item.name }); load(); };
          row.appendChild(into);
        }
        list.appendChild(row);
      }
    }

    cancel.onclick = () => { close(); builder.callback && builder.callback({ action: "cancel" }); };
    select.onclick = async () => {
      if (!picked.size) return;
      const docs = Array.from(picked.values()).map(item => ({ id: item.id, name: item.name, mimeType: item.mimeType }));
      await fetch(BASE + "/_standin/grant", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + builder.token }, body: JSON.stringify({ ids: docs.map(d => d.id) }) });
      close();
      builder.callback && builder.callback({ action: "picked", docs });
    };

    drawTabs();
    updateCount();
    load();
  }

  window.google = window.google || {};
  window.google.picker = {
    PickerBuilder,
    DocsView,
    ViewId: { DOCS: "all" },
    Feature: { MULTISELECT_ENABLED: "multiselectEnabled" },
    Action: { PICKED: "picked", CANCEL: "cancel" },
  };
  window.gapi = window.gapi || { load(name, callback) { setTimeout(callback, 0); } };
})();
`;
}
