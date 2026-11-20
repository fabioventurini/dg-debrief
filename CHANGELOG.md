# Changelog

## 0.2.0 — 2026-11-20

**The caps no longer cut the end of a session.**

- `LIMITS` raised from `{ events: 400, say: 80, chars: 400 }` to
  `{ events: 5000, say: 2000, chars: 2000 }`. A four-hour session went past 400 events, and the
  harvest stopped pushing when it hit the cap — so the *tail* of the session was what disappeared,
  which is the part a debrief most needs.
- If a cap is ever hit, the **tail survives** and the digest carries `truncated: true` with an
  accurate `dropped` count, instead of failing silently.
- **Checkpoints.** The last run's digest is saved to a world setting every ten minutes, and only
  when new chat has arrived. A closed Foundry window no longer loses the session; the app has a
  "Load checkpoint" button, and `game.modules.get("dg-debrief").api.checkpoint()` saves one by hand.
- Two tests added: tail preservation under a cap, and an untouched session reporting
  `truncated: false`.

## 0.1.0 — 2025-09-28

First version: harvest the chat log into a digest — rolls against their target and result, sanity
lost, damage taken, scene moves, and what the other dg-* tools announced.
