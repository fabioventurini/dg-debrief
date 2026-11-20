import { test } from "node:test";
import assert from "node:assert/strict";
import { harvest, readResult, readRollLabel, splitSessions, tally, SESSION_GAP_MS } from "../scripts/debrief-harvest.mjs";

const WORDS = { crit: "Critical Success!", fumble: "Critical Failure!", success: "Success", failure: "Failure" };

const T0 = new Date("1968-02-10T19:00:00").getTime();
const at = min => T0 + min * 60_000;

const view = (over = {}) => ({
  id: "m1", t: T0, author: "Fabio", alias: "ANDERSON", sceneName: "", style: "ic",
  hidden: false, text: "", rollLabel: "", verdict: "", flavor: "", modules: [], rolls: [], ...over,
});

const roll = (over = {}) => view({
  rollLabel: "Firearms: 50%", verdict: "Success", text: "1d100 41 41",
  rolls: [{ total: 41, type: "skill", key: "firearms" }], ...over,
});

test("the four results are read off the card, criticals before their plain halves", () => {
  assert.equal(readResult("1D100 4 CRITICAL SUCCESS!", WORDS), "critical");
  assert.equal(readResult("1D100 99 CRITICAL FAILURE!", WORDS), "fumble");
  assert.equal(readResult("1D100 41 Success", WORDS), "success");
  assert.equal(readResult("1D100 74 Failure", WORDS), "failure");
  assert.equal(readResult("no verdict here", WORDS), null);
});

test("the roll label splits into skill and target, and survives having no target", () => {
  assert.deepEqual(readRollLabel("Firearms: 50%"), { label: "Firearms", target: 50 });
  assert.deepEqual(readRollLabel("Sanity: 52%"), { label: "Sanity", target: 52 });
  assert.deepEqual(readRollLabel("Art (Photography): 40%"), { label: "Art (Photography)", target: 40 });
  assert.deepEqual(readRollLabel("Damage"), { label: "Damage", target: null });
  assert.deepEqual(readRollLabel(""), { label: "", target: null });
});

test("a run of chat splits on a five-hour silence, not on a pause for coffee", () => {
  const runs = splitSessions([
    view({ t: at(0) }), view({ t: at(40) }), view({ t: at(75) }),
    view({ t: at(40 + 6 * 60) }), view({ t: at(80 + 6 * 60) }),
  ], SESSION_GAP_MS);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map(r => r.length), [3, 2]);
});

test("a scene event is emitted when the speaker's scene changes, once per change", () => {
  const d = harvest([
    roll({ t: at(0), sceneName: "Rue de la Tour" }),
    roll({ t: at(5), sceneName: "Rue de la Tour" }),
    roll({ t: at(9), sceneName: "The Warehouse" }),
  ], { words: WORDS });
  const scenes = d.events.filter(e => e.kind === "scene");
  assert.deepEqual(scenes.map(e => e.name), ["Rue de la Tour", "The Warehouse"]);
  assert.equal(d.scenes.length, 2);
});

test("rolls carry who, skill, target, total and verdict; sanity damage becomes a loss", () => {
  const d = harvest([
    roll({ t: at(14), alias: "ANDERSON", verdict: "CRITICAL FAILURE!", rolls: [{ total: 98, type: "skill", key: "firearms" }] }),
    view({ t: at(15), alias: "ANDERSON", rollLabel: "Sanity Damage", text: "1D6 6", rolls: [{ total: 6, type: "sanity-damage" }] }),
    view({ t: at(16), alias: "GALLOWAY", rollLabel: "Damage", text: "1D10 9", rolls: [{ total: 9, type: "damage" }] }),
  ], { words: WORDS });

  assert.deepEqual(d.events.map(e => e.kind), ["roll", "sanity-loss", "damage"]);
  assert.deepEqual(d.events[0], { t: "19:14", at: at(14), kind: "roll", who: "ANDERSON", label: "Firearms", total: 98, target: 50, result: "fumble", type: "skill" });
  assert.equal(d.events[1].total, 6);
  assert.equal(d.tally.sanityLost.ANDERSON, 6);
  assert.equal(d.tally.damage, 9);
});

test("a message another dg- tool posted is a tool event, not narration", () => {
  const d = harvest([
    view({ t: at(20), modules: ["Suspicion"], text: "Marseille +10 → 40" }),
    view({ t: at(21), alias: "Handler", text: "The stairwell smells of creosote." }),
  ], { words: WORDS });
  assert.deepEqual(d.events.map(e => e.kind), ["tool", "say"]);
  assert.equal(d.events[0].source, "Suspicion");
  assert.equal(d.events[1].text, "The stairwell smells of creosote.");
});

test("cast is who rolled, busiest first; empty messages are dropped", () => {
  const d = harvest([
    roll({ alias: "ANDERSON", t: at(1) }), roll({ alias: "ANDERSON", t: at(2) }),
    roll({ alias: "GALLOWAY", t: at(3) }), view({ t: at(4), text: "   " }),
  ], { words: WORDS });
  assert.deepEqual(d.cast, [{ name: "ANDERSON", rolls: 2 }, { name: "GALLOWAY", rolls: 1 }]);
  assert.equal(d.events.length, 3);
});

test("the digest stays inside its caps and says how much it left out", () => {
  const many = Array.from({ length: 30 }, (_, i) => roll({ t: at(i), id: `m${i}` }));
  const d = harvest(many, { words: WORDS, limits: { events: 10, say: 5, chars: 20 } });
  assert.equal(d.events.length, 10);
  assert.equal(d.dropped, 20);

  const long = harvest([view({ text: "x".repeat(500) })], { words: WORDS, limits: { events: 10, say: 5, chars: 20 } });
  assert.equal(long.events[0].text.length, 20);
  assert.ok(long.events[0].text.endsWith("…"));
});

test("tally counts each verdict once and ignores anything that is not a roll", () => {
  const t = tally([
    { kind: "roll", result: "success" }, { kind: "roll", result: "success" },
    { kind: "roll", result: "fumble" }, { kind: "roll", result: null },
    { kind: "scene", name: "x" }, { kind: "say", text: "y" },
  ]);
  assert.equal(t.rolls, 4);
  assert.equal(t.success, 2);
  assert.equal(t.fumble, 1);
  assert.equal(t.scenes, 1);
});

test("an empty log produces an empty digest rather than throwing", () => {
  const d = harvest([], { words: WORDS });
  assert.deepEqual(d.events, []);
  assert.equal(d.from, null);
  assert.equal(d.tally.rolls, 0);
});

test("the verdict is read from the dice-formula slot the system prints it into, not the body", () => {
  const d = harvest([
    view({ rollLabel: "Firearms: 50%", verdict: "Success", text: "1d100 19 19 19", rolls: [{ total: 19, type: "skill" }] }),
    view({ rollLabel: "SAN: 50%", verdict: "", text: "Success 1d100 19", rolls: [{ total: 19, type: "sanity" }] }),
  ], { words: WORDS });
  assert.equal(d.events[0].result, "success", "the slot wins when it has the word");
  assert.equal(d.events[1].result, "success", "the body is the fallback when the slot is empty");
});

test("the event cap keeps the end of the session, not the start", () => {
  /* 12 chat lines, cap of 5: the last five must survive, and the digest must say it was cut. */
  const views = Array.from({ length: 12 }, (_, i) => view({ id: `m${i}`, t: at(i), text: `line ${i}` }));
  const d = harvest(views, { words: WORDS, limits: { events: 5, say: 500, chars: 400 } });
  assert.equal(d.events.length, 5);
  assert.equal(d.truncated, true);
  assert.equal(d.dropped, 7);
  assert.deepEqual(d.events.map(e => e.text), ["line 7", "line 8", "line 9", "line 10", "line 11"]);
});

test("a session under the cap is untouched and says so", () => {
  const views = Array.from({ length: 6 }, (_, i) => view({ id: `n${i}`, t: at(i), text: `line ${i}` }));
  const d = harvest(views, { words: WORDS, limits: { events: 50, say: 50, chars: 400 } });
  assert.equal(d.events.length, 6);
  assert.equal(d.truncated, false);
  assert.equal(d.dropped, 0);
});
