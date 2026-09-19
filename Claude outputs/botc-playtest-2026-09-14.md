# Clocktower Companion — playtest report, 2026-09-14

Tested against the local dev server (`npm run dev`, Supabase project `pahyrlxmqfqbgqpbeyqn`) using the `/dev` simulator plus a second real Storyteller tab opened on the same game (`/host/<id>`), so I could compare "the same screen after a reload" against "the same screen left open."

Two games were built (10-seat and 7-seat, Trouble Brewing). Roles dealt included Imp, Spy, Scarlet Woman, Poisoner (evil), and Investigator, Chef, Washerwoman, Fortune Teller, Undertaker (info roles), which covers most of the interesting "who sees what" cases.

## Headline bug: phase changes don't reach open screens — only a reload shows them

**What I did:** On the Storyteller page, clicked "Advance to Night 1." The button visibly "worked" (no error), and the underlying `rpc/set_phase` call returned success (204) confirmed via the network log.

**What went wrong:** The Storyteller's own screen kept showing "Lobby" — indefinitely, not just for a second. So did the same game's simulator panel. So did a player's screen (Bot 3, the Imp) sitting right there the whole time. All three were still actively polling other tables every ~350ms (seats, roles, meeting requests all updated fine), but the *phase* field never refreshed on screen.

**Reloading the page** (full browser refresh, no other change) immediately showed the correct state: "Night 1," countdown running, Night-dispatch panel populated with real send buttons. So the data is correct in Supabase from the moment the button is clicked — this is purely a client-side "the open tab doesn't know the phase changed" bug, not a backend bug.

**Why this matters for your actual question:** this is the mechanism the whole game runs on. Concretely, I sent the Imp's real Night 1 reveal ("You are the Imp. Your Minions: Bot 6...") from the Storyteller's screen. It was correctly written to the database and showed up on the Storyteller's own reloaded view — but it never appeared on the Imp's (Bot 3's) screen, because that screen still thought it was Lobby and doesn't render night info outside of a night phase. At a real party, this means: Storyteller taps "Advance to Night 1," and nobody's phone actually shows Night 1 — or their role's night prompt — unless they happen to manually pull-to-refresh at the right moment. That defeats the "phones buzz with the right info at the right time" premise pretty completely, at least in this build.

One nuance worth keeping: the *countdown timer itself* ticks correctly even without a reload (7:54, 7:53...) — because per your architecture notes, each device computes the countdown locally from a stored start time rather than needing a live push. So the clock math is fine; it's specifically the phase *label* (and whatever's gated on it — night dispatch, info reveals) that's stuck.

I'd guess the fix is either: the poll loop isn't actually updating the reactive `phase` value it reads into (classic Svelte 5 runes pitfall — mutating a fetched object without a fresh `$state` assignment), or the component reads phase once from a prop/derived at mount and never re-subscribes. Worth grepping wherever `phase` is bound in the Storyteller/player Svelte components for a `$state`/`$derived` that isn't actually reactive to the poll results.

## Second bug: nominations/votes give 404 on every single poll

Every ~350ms poll cycle throws two 404s:
```
GET /rest/v1/nominations?select=*&game_id=eq...   → 404
GET /rest/v1/votes?select=*                        → 404
```
`db/schema.sql` on disk does define `nominations` and `votes` tables — so the SQL file is right, but the **live Supabase project doesn't have them**, presumably because the schema script was last run before those tables were added and hasn't been re-run since. The Vote tab itself loads without visibly erupting (nomination form renders, correctly disabled outside Day phase), but given the queries backing it 404 on every single poll, I'd expect nominating/voting to silently do nothing once you reach Day phase — worth re-running `db/schema.sql` in the Supabase SQL editor before your next real playtest (heads up: per the README this wipes existing game data).

This alone is also a lot of dead weight: 2 failed requests × ~3/sec × however many screens are open is a meaningful amount of avoidable traffic/battery for a phone at a party.

## What's actually working correctly (the good news)

Where I could get a clean read (by reloading to route around the bug above), the actual "right info to right seat" targeting looked solid:

- **Role cards are correctly seat-scoped.** Bot 1 only ever saw the Fortune Teller card; Bot 3 only ever saw the Imp card. No leakage of other seats' roles in the UI text.
- **Evil-team mutual recognition worked as designed.** The Imp's screen (once loaded fresh) showed "Your Minions: Bot 6 (the Poisoner)"; the Poisoner's showed "The Demon is Bot 3 (the Imp)." Correct pairing, correctly worded, correctly private to those two seats.
- **Info-role suggestions (Washerwoman/Investigator/Chef) generated sensible Neutral / Helps-good / Helps-evil wordings** for the Storyteller to pick from, exactly as the design doc describes — nothing was auto-sent.
- **The meeting-request queue routed correctly.** I tapped "Ask to see the Storyteller" from Bot 1's screen; it instantly showed "#1 · Bot 1" with a red badge on the Storyteller's Requests tab, and nowhere else. Bot 1's own screen correctly showed "Waiting to see the Storyteller — you're #1 in line," with no visibility into anyone else's request.
- **The stained-glass avatars render well in-app** — saw the Imp portrait rendering correctly in the arch frame on a player's own role card.

## Suggested next steps, in order

1. Fix the phase-reactivity bug — this blocks basically everything else from being testable end-to-end live. Once fixed, re-test with two tabs left open the whole time (no reloads) to confirm dispatches, nominations, and Night 2 kills actually push through live.
2. Re-run `db/schema.sql` against the live Supabase project to pick up the `nominations`/`votes` tables.
3. Once both are fixed, worth a real "leave every tab open and just play" pass through a full night → day → nomination → execution → night 2 cycle, since I stopped short of Night 2/kill routing once the phase bug made it clear that testing further blind (via reload-to-check) wouldn't tell you much about live behavior.

Everything above is reproducible from a completely clean `npm run dev` — happy to re-run any specific piece if you want to watch it live.
