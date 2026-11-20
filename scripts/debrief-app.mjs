/* The one window: what the chat log holds, and the two ways to take it out of Foundry. */

import { digest, readCheckpoint, settings, windows } from "./dg-debrief.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

const KIND = {
  scene: "SCENE",
  roll: "ROLL",
  "sanity-loss": "SAN",
  damage: "DAMAGE",
  lethality: "LETHAL",
  tool: "TOOL",
  say: "SAID",
};

const RESULT = { critical: "CRITICAL", success: "SUCCESS", failure: "FAILURE", fumble: "FUMBLE" };

function line(e) {
  const bits = [];
  if (e.who) bits.push(`<b>${esc(e.who)}</b>`);
  if (e.name) bits.push(esc(e.name));
  if (e.label) bits.push(esc(e.label));
  if (e.target != null) bits.push(`<span class="dgdb-dim">target ${e.target}</span>`);
  if (e.total != null) bits.push(`<span class="dgdb-num">${esc(e.total)}</span>`);
  if (e.result) bits.push(`<span class="dgdb-res dgdb-${e.result}">${RESULT[e.result]}</span>`);
  if (e.source) bits.push(`<span class="dgdb-dim">${esc(e.source)}</span>`);
  if (e.text) bits.push(esc(e.text));
  return bits.join(" ");
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try { return !!game.clipboard?.copyPlainText(text); } catch { return false; }
  }
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class DebriefApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "dg-debrief",
    classes: ["dg-debrief"],
    window: { title: "Debrief — what the chat log holds", icon: "fa-solid fa-clipboard-list", resizable: true },
    position: { width: 760, height: 660 },
  };

  static #instance = null;
  static show() { this.#instance ??= new DebriefApp(); return this.#instance.render(true); }
  static refresh() { if (DebriefApp.#instance?.rendered) DebriefApp.#instance.render(); }

  #which = "run";
  #checkpoint = null;

  async _renderHTML() {
    const w = windows();
    const d = this.#checkpoint ?? digest(this.#which);
    const el = document.createElement("div");
    el.className = "dgdb";
    el.innerHTML = `
      <header class="dgdb-head">
        <label class="dgdb-field">
          <span>Operation</span>
          <input type="text" name="operation" value="${esc(settings.operation)}" placeholder="OPERATION NAME" />
        </label>
        <label class="dgdb-field">
          <span>Take</span>
          <select name="which">
            ${Object.entries(w).map(([k, v]) =>
              `<option value="${k}"${k === this.#which ? " selected" : ""}>${esc(v.label)} — ${v.views.length} messages</option>`).join("")}
          </select>
        </label>
      </header>

      <div class="dgdb-tally">
        ${[
          ["Rolls", d.tally.rolls],
          ["Success", d.tally.success],
          ["Failure", d.tally.failure],
          ["Critical", d.tally.critical],
          ["Fumble", d.tally.fumble],
          ["Scenes", d.tally.scenes],
        ].map(([k, n]) => `<div class="dgdb-stat"><b>${n}</b><span>${k}</span></div>`).join("")}
      </div>

      <ol class="dgdb-log">
        ${d.events.map(e => `
          <li class="dgdb-e dgdb-e-${e.kind}">
            <span class="dgdb-t">${esc(e.t)}</span>
            <span class="dgdb-k">${KIND[e.kind] ?? e.kind.toUpperCase()}</span>
            <span class="dgdb-b">${line(e)}</span>
          </li>`).join("") || `<li class="dgdb-empty">Nothing in this window.</li>`}
      </ol>

      <footer class="dgdb-foot">
        <button type="button" data-do="mark">Mark session start</button>
        <span class="dgdb-grow"></span>
        <button type="button" data-do="loadcp">${this.#checkpoint ? "Back to live" : "Load checkpoint"}</button>
        <button type="button" data-do="file">Save digest file</button>
        <button type="button" data-do="copy" class="dgdb-go">Copy digest</button>
      </footer>`;
    return el;
  }

  async _replaceHTML(el, content) {
    content.replaceChildren(el);

    content.querySelector("[name=operation]")?.addEventListener("change", ev => {
      settings.operation = ev.currentTarget.value;
    });
    content.querySelector("[name=which]")?.addEventListener("change", ev => {
      this.#which = ev.currentTarget.value;
      this.render();
    });

    for (const btn of content.querySelectorAll("[data-do]")) {
      const what = btn.dataset.do;
      btn.addEventListener("click", async () => {
        if (what === "loadcp") {
          if (this.#checkpoint) {
            this.#checkpoint = null;
          } else {
            const cp = readCheckpoint();
            if (!cp) ui.notifications.warn("Debrief: no checkpoint saved yet.");
            this.#checkpoint = cp ?? null;
          }
          this.render();
          return;
        }
        if (what === "mark") {
          settings.mark = Date.now();
          ui.notifications.info("Debrief: session start marked.");
          this.render();
          return;
        }
        const d = digest(this.#which);
        const text = JSON.stringify(d, null, 1);
        if (what === "copy") {
          const ok = await copy(text);
          if (ok) ui.notifications.info(`Debrief: ${d.events.length} events copied.`);
          else ui.notifications.error("Debrief: the clipboard refused — use Save digest file instead.");
          return;
        }
        const stamp = new Date(d.capturedAt).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
        download(text, `debrief-${stamp}.json`);
      });
    }
  }
}
