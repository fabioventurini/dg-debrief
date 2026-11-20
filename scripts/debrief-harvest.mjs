/* The harvest: a run of chat messages in, one session digest out.

   Nothing in this file touches Foundry. The caller flattens each ChatMessage into a plain
   "view" (see toView in dg-debrief.mjs) and passes the localized result words in, so the
   whole classification can be tested against literals. */

export const DIGEST_VERSION = 1;

/* A session is a contiguous run of chat. Five hours of silence ends one. */
export const SESSION_GAP_MS = 5 * 60 * 60 * 1000;

/* Generous on purpose. A four-hour session runs well past a few hundred events, and the old caps
   truncated silently — worse, they truncated the *end*, which is the part a debrief most needs.
   The numbers here are high enough that a normal session is never cut, and if one ever is,
   `truncated` says so and the tail is what survives. */
export const LIMITS = {
  events: 5000,
  say: 2000,
  chars: 2000,
};

const clean = (s, n = LIMITS.chars) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const hhmm = ms => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const norm = s => String(s ?? "").toUpperCase().replace(/[^A-Z ]/g, "").trim();

/** Split every message into sessions, oldest first, each a contiguous run of chat. */
export function splitSessions(views, gapMs = SESSION_GAP_MS) {
  const sorted = [...views].sort((a, b) => a.t - b.t);
  const runs = [];
  let run = null;
  for (const v of sorted) {
    if (!run || v.t - run[run.length - 1].t > gapMs) runs.push((run = []));
    run.push(v);
  }
  return runs;
}

/** Which of the four the roll came out as, read off the card's own words. */
export function readResult(text, words) {
  const t = norm(text);
  const has = w => w && t.includes(norm(w));
  if (has(words.crit)) return "critical";
  if (has(words.fumble)) return "fumble";
  if (has(words.success)) return "success";
  if (has(words.failure)) return "failure";
  return null;
}

/** "Firearms: 50%" — the skill and the number it had to beat. */
export function readRollLabel(label) {
  const t = clean(label, 120);
  if (!t) return { label: "", target: null };
  const cut = t.lastIndexOf(":");
  const head = cut > 0 ? t.slice(0, cut) : t;
  const tail = cut > 0 ? t.slice(cut + 1) : "";
  const n = tail.match(/-?\d+/);
  return { label: clean(head, 80), target: n ? Number(n[0]) : null };
}

const ROLL_KINDS = {
  "sanity-damage": "sanity-loss",
  damage: "damage",
  lethality: "lethality",
};

function rollEvent(v, words) {
  const roll = v.rolls[0];
  const { label, target } = readRollLabel(v.rollLabel);
  const kind = ROLL_KINDS[roll.type] ?? "roll";
  const e = { t: hhmm(v.t), at: v.t, kind, who: v.alias, label: label || clean(v.flavor, 80), total: roll.total };
  if (kind === "roll") {
    e.target = target;
    e.result = readResult(v.verdict || v.text, words);
    e.type = roll.type ?? null;
  }
  if (v.hidden) e.hidden = true;
  return e;
}

/** Everything the session left in the chat log, in order, with the routine stripped out. */
export function harvest(views, { words, limits = LIMITS } = {}) {
  const sorted = [...views].sort((a, b) => a.t - b.t);
  const events = [];
  const cast = new Map();
  const scenes = [];
  let scene = null;
  let says = 0;
  let dropped = 0;

  const push = e => { events.push(e); };

  for (const v of sorted) {
    if (v.sceneName && v.sceneName !== scene) {
      scene = v.sceneName;
      scenes.push({ t: hhmm(v.t), at: v.t, name: scene });
      push({ t: hhmm(v.t), at: v.t, kind: "scene", name: scene });
    }

    if (v.rolls.length) {
      const e = rollEvent(v, words);
      push(e);
      if (e.who) cast.set(e.who, (cast.get(e.who) ?? 0) + 1);
      continue;
    }

    if (v.modules.length) {
      const text = clean(v.text, limits.chars);
      if (text) push({ t: hhmm(v.t), at: v.t, kind: "tool", source: v.modules[0], text });
      continue;
    }

    const text = clean(v.text, limits.chars);
    if (!text) continue;
    if (says >= limits.say) { dropped += 1; continue; }
    says += 1;
    push({ t: hhmm(v.t), at: v.t, kind: "say", who: v.alias || v.author, text, voice: v.style });
  }

  /* Over cap: keep the tail. The start of a session can be reconstructed from the transcript;
     the end cannot, and losing it is what the old 400-event cap did. */
  let truncated = false;
  let overflow = 0;
  if (events.length > limits.events) {
    overflow = events.length - limits.events;
    events.splice(0, overflow);
    truncated = true;
    dropped += overflow;
  }

  return {
    v: DIGEST_VERSION,
    from: sorted.length ? sorted[0].t : null,
    to: sorted.length ? sorted[sorted.length - 1].t : null,
    scenes,
    cast: [...cast].sort((a, b) => b[1] - a[1]).map(([name, rolls]) => ({ name, rolls })),
    events,
    dropped,
    truncated,
    tally: tally(events),
  };
}

/** The numbers worth putting at the top of a digest. */
export function tally(events) {
  const t = { rolls: 0, success: 0, failure: 0, critical: 0, fumble: 0, sanityLost: {}, damage: 0, scenes: 0 };
  for (const e of events) {
    if (e.kind === "scene") t.scenes += 1;
    if (e.kind === "damage") t.damage += Number(e.total) || 0;
    if (e.kind === "sanity-loss") {
      const who = e.who || "—";
      t.sanityLost[who] = (t.sanityLost[who] ?? 0) + (Number(e.total) || 0);
    }
    if (e.kind !== "roll") continue;
    t.rolls += 1;
    if (e.result) t[e.result] += 1;
  }
  return t;
}
