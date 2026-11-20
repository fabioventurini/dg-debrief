/* Debrief: what the chat log remembers about a session, handed over in one piece.

   Handler only. Nothing here writes to a document — it reads game.messages, classifies what
   it finds, and produces a digest for the Debrief page to ask questions from.

   The digest is the machine's half of the record: rolls, sanity, scene moves, whatever the
   other dg-* tools announced. The half only the Handler has goes in on the phone afterwards. */

import { harvest, splitSessions, SESSION_GAP_MS } from "./debrief-harvest.mjs";
import { DebriefApp } from "./debrief-app.mjs";

export const MODULE_ID = "dg-debrief";

export const settings = {
  get operation() { return game.settings.get(MODULE_ID, "operation"); },
  set operation(v) { game.settings.set(MODULE_ID, "operation", String(v ?? "")); },
  get mark() { return game.settings.get(MODULE_ID, "mark"); },
  set mark(v) { game.settings.set(MODULE_ID, "mark", Number(v) || 0); },
};

const STYLE = { 0: "other", 1: "ooc", 2: "ic", 3: "emote" };

const scratch = () => document.createElement("div");

/** A ChatMessage flattened into the plain shape the harvest works on. */
export function toView(msg) {
  const box = scratch();
  box.innerHTML = msg.content ?? "";
  const rollLabel = box.querySelector(".dg-chat-card__roll-label")?.textContent ?? "";
  /* The system prints the verdict into the dice-formula slot, where a plain Foundry roll puts
     "1d100" — so it is read from there before the dice furniture is stripped out. */
  const verdict = box.querySelector(".dice-formula")?.textContent ?? "";
  for (const el of box.querySelectorAll(".dice-formula, .dice-tooltip, .dice-result .dice-rolls, button")) el.remove();

  const sceneName = msg.speaker?.scene ? game.scenes.get(msg.speaker.scene)?.name ?? "" : "";
  const modules = Object.keys(msg.flags ?? {})
    .filter(k => k.startsWith("dg-") && game.modules.get(k))
    .map(k => game.modules.get(k).title.replace(/^DG [^·]*· /, ""));

  return {
    id: msg.id,
    t: msg.timestamp,
    author: msg.author?.name ?? "",
    alias: msg.speaker?.alias || msg.author?.name || "",
    sceneName,
    style: STYLE[msg.style] ?? "other",
    hidden: !!(msg.whisper?.length || msg.blind),
    text: box.textContent ?? "",
    rollLabel,
    verdict,
    flavor: msg.flavor ?? "",
    modules,
    rolls: (msg.rolls ?? []).map(r => ({
      total: r.total,
      type: r.options?.rollType ?? null,
      key: r.options?.key ?? null,
    })),
  };
}

export const words = () => ({
  crit: game.i18n.localize("DG.Roll.CriticalSuccess"),
  fumble: game.i18n.localize("DG.Roll.CriticalFailure"),
  success: game.i18n.localize("DG.Roll.Success"),
  failure: game.i18n.localize("DG.Roll.Failure"),
});

const views = () => game.messages.contents.map(toView);

/** The three windows the Handler can ask for, each a slice of the log. */
export function windows(all = views(), now = Date.now(), mark = settings.mark) {
  const runs = splitSessions(all, SESSION_GAP_MS);
  const last = runs[runs.length - 1] ?? [];
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  return {
    run: { label: "Last run of play", views: last },
    mark: { label: "Since I marked the start", views: mark ? all.filter(v => v.t >= mark) : [] },
    today: { label: "Today", views: all.filter(v => v.t >= midnight.getTime()) },
  };
}

/* A checkpoint is a copy of the last run's digest kept in a world setting, so a session survives
   Foundry being closed, or a browser tab dying, before anyone clicks Save. It is written at most
   every ten minutes, and only when new chat has arrived since the last one. */
export function saveCheckpoint() {
  if (!game.user?.isGM) return null;
  const d = digest("run");
  if (!d.events.length) return null;
  const prev = readCheckpoint();
  if (prev && prev.to === d.to) return prev;
  game.settings.set(MODULE_ID, "checkpoint", JSON.stringify(d));
  return d;
}

export function readCheckpoint() {
  const raw = game.settings.get(MODULE_ID, "checkpoint");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function digest(which = "run") {
  const w = windows()[which] ?? windows().run;
  return {
    ...harvest(w.views, { words: words() }),
    world: game.world.id,
    operation: settings.operation,
    window: which,
    capturedAt: Date.now(),
  };
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "operation", {
    name: "Operation", scope: "world", config: false, type: String, default: "",
  });
  game.settings.register(MODULE_ID, "mark", {
    name: "Session start", scope: "world", config: false, type: Number, default: 0,
  });
  game.settings.register(MODULE_ID, "checkpoint", {
    name: "Last checkpoint", scope: "world", config: false, type: String, default: "",
  });

  /* Set at init, not ready: the HUD builds its tabs at ready and must find this already there. */
  game.modules.get(MODULE_ID).api = {
    open: () => (game.user.isGM ? DebriefApp.show() : null),
    digest: which => (game.user.isGM ? digest(which) : null),
    markStart: () => { if (game.user.isGM) settings.mark = Date.now(); },
    checkpoint: () => saveCheckpoint(),
    readCheckpoint: () => readCheckpoint(),
  };
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user?.isGM) return;
  const group = controls.tokens ?? controls.token ??
                (Array.isArray(controls) ? controls.find(c => c.name === "token") : null);
  if (!group) return;
  const tool = {
    name: "dg-debrief-open",
    title: "Debrief",
    icon: "fa-solid fa-clipboard-list",
    button: true,
    visible: true,
    onChange: () => DebriefApp.show(),
    onClick: () => DebriefApp.show(),
  };
  if (Array.isArray(group.tools)) group.tools.push(tool);
  else group.tools[tool.name] = tool;
});

/* Ten minutes is a compromise: often enough that a crash costs little, rare enough that a world
   setting is not rewritten constantly, and only when the chat has actually moved. */
Hooks.once("ready", () => {
  if (!game.user?.isGM) return;
  globalThis.setInterval(() => {
    try { saveCheckpoint(); } catch (err) { console.warn("dg-debrief: checkpoint failed", err); }
  }, 10 * 60 * 1000);
});
