# Decision log

Short records of choices that would otherwise be hard to reconstruct. Newest first.

## 2026-09-09b — stained-glass v5: depth + gloss pass, re-rendered Monk/Scarlet Woman

- **`_depth_and_gloss()` added to `stained_glass.py`.** A small, cheap pass
  applied last over the whole finished window (glass and stone alike): a
  gentle vignette (darker toward the lower corners, clear near the top —
  reads as the window sitting a little recessed) plus a soft diagonal
  glass-glare streak from the upper-left, screen-blended in. Deliberately
  subtle by request ("a very small effect for depth... very light
  reflection") — these avatars render small (seat-circle thumbnail,
  role-card portrait), so anything past the default `depth_strength=0.10`
  just muddies the linework without reading as more "glass" at that size.
  On by default; `depth=False` / `--no-depth` turns it off.
- **All seven avatars re-run** — Mickey repainted Monk and Scarlet Woman
  (design source mtimes updated) since the v4 pass, so this rerun picks up
  those edits as well as adding the new depth/gloss pass to all seven,
  including the five that didn't change.

## 2026-09-09 — stained-glass v4: stone window border, Monk + Scarlet Woman

- **`_stone_border()` added to `stained_glass.py`.** A mottled stone reveal
  is now carved just inside the arch's own silhouette (no extra canvas
  needed). First pass bulged it into a pier/buttress shape at the two base
  corners; on review against the actual paintings that read as lumpy/odd
  rather than architectural ("the bottom corners look a little odd"), so
  it was simplified to a single **uniform thickness all the way round**,
  including a clean flat strip along the arch's flat bottom edge — still a
  per-pixel mask off the arch's own distance transform, just a constant
  threshold instead of a corner-dependent one. On by default
  (`border=True`); `--no-border` on the CLI, or `border=False` in code,
  restores the old edge-to-edge glass look.
- **All seven avatars regenerated at `--strength strong`** with the new
  border (`static/avatars/{washerwoman,librarian,poisoner,imp,chef,monk,
  scarlet-woman}.png`) — the five existing ones re-run for consistency, plus
  two new characters: **Monk** and **Scarlet Woman**, both painted and
  processed this session. `scarlet-woman` matches the character id in
  `trouble-brewing.ts` (hyphenated, not underscored).
- Reviewed as a 7-up labelled grid composited on the actual card background
  before judging, twice (bulged, then uniform) — the uniform version reads
  consistently across pale (Librarian), saturated (Scarlet Woman), and
  dark/desaturated (Imp) palettes alike, with no odd-looking corners.

## 2026-09-08c — procedural textures, Chef avatar

- **Textures are now generated, not sourced.** `scripts/make_textures.py`
  builds all four seamless background textures (`limestone.jpg`,
  `parchment.jpg`, `oak.jpg`, and a new `redstone.jpg`) straight from the
  app's own `app.css` colour tokens (`--bg`, `--surface`, `--redstone`,
  `--lead`, etc.), so they match the theme by construction and there's
  nothing to hand-draw or licence-check. Tiling comes from a simple
  value-noise-with-wrapped-padding trick (pad a small random grid with
  `mode="wrap"`, resize up with PIL, crop the wrap margin back off) — no
  Perlin/FFT library needed. Each texture is its own function with a `seed`
  arg for a different roll of the same look. `static/textures/README.md`
  rewritten to lead with this as the recommended path, keeping the
  free-CC0-photo-site list (ambientCG, Poly Haven, etc.) as an alternative
  for anyone who wants a more photographic finish later.
- **New `--redstone-tex` CSS var added to `app.css`**, alongside the
  existing three — reserved, not wired into any layout element yet (a
  `.card` `border-top` via `border-image` was considered and rejected: reads
  poorly at 3px height). Sits ready for whenever a header band or a thicker
  rule wants real grain instead of a flat `--redstone` fill.
- **Fifth avatar, Chef, copied into the live app**
  (`static/avatars/chef.png`), run through `stained_glass.py` v3 at
  `--strength strong`, same as the first four.

## 2026-09-08b — stained-glass v3: thin-only leading, first four avatars live

- **`find_leading()` now requires THINNESS, not just dark+desaturated.** A
  broad flat fill can be exactly as dark and desaturated as real ink,
  especially by design on the evil characters' palettes — the Imp's
  charcoal cave-wall background and grey horns were being swept into the
  line mask wholesale and flattened to uniform near-black, fusing with the
  real linework and with each other ("dark clusters get mashed together").
  The fix has to be pointwise (each candidate pixel's own distance to the
  nearest non-candidate pixel, thresholded), not the per-connected-component
  test `find_and_fill_gaps()` uses for hairline gaps — the ink in these
  paintings is essentially always one giant connected mesh via its
  junctions, so a component-level thinness test would disqualify the whole
  network the moment it touched one thick fill or junction blob. Verified
  against the Imp (background/horns keep their own tone now) and the
  Poisoner (cloak stays a rich dark blue-purple, not flat black); re-checked
  the Librarian's bookshelf line junctions for regressions — clean.
- **First four avatars copied into the live app**: `static/avatars/
  {washerwoman,librarian,poisoner,imp}.png`, all run through
  `stained_glass.py` at `--strength strong` (Mickey's preferred preset).
  `scripts/stained_glass.py` in the repo is this v3.

## 2026-09-08 — Night-dispatch preview mode, candidate-label rewording, stained-glass v2, tap targets

- **`NightDispatch` gained an optional `previewNight` prop instead of a second
  component.** The real Storyteller page never passes it, so it behaves
  exactly as before — the queue only exists once the game clock is actually
  in a night phase, and every button really sends/asks. The `/dev` simulator
  passes a chosen night number instead; when that differs from the game's
  actual current night, the panel renders read-only (candidates and ability
  text shown as reference, no send/ask/clear buttons) rather than letting a
  preview action silently create a real `night_actions` row for a night that
  hasn't arrived — `sendNightInfo`/`askNightChoice` are plain table
  upserts with no server-side phase check, so this had to be enforced in the
  UI. Rationale for previewing at all: solo-testing on `/dev` had no way to
  see a role's night info/prompt without first walking the phase clock to
  that exact night, which is exactly the visibility gap that prompted this.
- **Candidate-info labels renamed**: `Truth` → `Neutral`, `Leans good` →
  `Helps good team`, `Leans evil` → `Helps evil team` (`nightInfo.ts`). Same
  underlying logic (a decoy or a poisoned-number lie chosen to tilt
  suspicion one way), just worded to match how the Storyteller actually
  thinks about the choice. The always-present free-text box next to the
  candidates already covered "make your own" — no new field needed there.
- **`/dev` gained a "Roles in play" reference card**, listing every dealt
  seat's character, team, ability text and night-timing at a glance —
  addresses the same visibility gap for characters that never appear in
  night dispatch at all (day-side/passive roles like Virgin, Slayer, Baron),
  which the preview-night stepper above can't reach since they have nothing
  to dispatch.
- **`stained_glass.py` v2**: the leading-line detector was brightness-only,
  so dark *saturated* fills (navy, forest green) were misread as ink and
  recoloured — fixed by requiring low brightness **and** low chroma. The
  lead-came highlight was a warm gold blended too heavily across the whole
  line width, reading brown instead of black — fixed with a neutral pewter
  highlight, a near-black base, and a much narrower ridge falloff. Added
  `find_and_fill_gaps()`: Krita bucket-fill leaves thin (1-3px) unfilled
  hairline gaps at some line junctions; detected via an inscribed-circle
  (max distance-transform radius) test that tells a thin crack apart from a
  legitimately pale design element (a bonnet, a dress — thin nowhere), then
  inpainted from the nearest confident pane colour before the glass effect
  runs. Verified on all four painted avatars so far (Washerwoman, Librarian,
  Poisoner, Imp).
- **Every button/input/select gets a guaranteed ≥44px tap target by
  default** (`min-height` on the base rules in `app.css`), including the
  theme-toggle candle button (was 2.4rem, now 2.75rem) and a couple of
  `/dev`-only controls (the bot life-icon, the "clear" text link opts back
  out via `min-height: auto` since it's meant to read as a plain link, not a
  button). The rest of the phone-layout pass (breakpoints on the seating
  circle, avatars, card padding) was already in place from 2026-09-07.

## 2026-09-07 — Lobby controls, gothic-arch avatars, pale theme default, tabbed simulator

- **Kept the existing Supabase project and schema rather than starting a new
  one.** The foundations (`db/schema.sql`, RLS, RPCs) were already verified
  against a live project and are solid; the ask was additive (seat lifecycle,
  not a redesign), so `schema.sql` was extended in place and re-run
  (drop-and-recreate, per its own header comment) rather than standing up a
  fresh project. Old artifact-era files (`clocktower_local.html`,
  `server.py`) moved to `archive/` — superseded by this app, kept for
  reference rather than deleted.
- **Seat writes moved off the raw `seats` table for players.** The old
  `seats_update` RLS policy let a device update *any* column on its own seat
  row (not just name) because it only had a `using` clause, no `with check`
  — a player could theoretically revive themselves. Replaced with two
  SECURITY DEFINER RPCs, `set_my_name()` and `leave_seat()`, and narrowed
  `seats_update` to storyteller-only. `kick_seat()` (storyteller freeing a
  seat) and `move_seat()` (storyteller swapping a seat with its ring
  neighbour, one statement so the `unique(game_id, seat_index)` constraint
  never sees a transient clash) round out lobby control. Leaving/kicking
  clears `seat_roles` and any waiting `meet_requests` for that seat so a
  later, different occupant never inherits the previous sitter's secret
  role — seat_index (and therefore the circle) stays stable either way.
- **Character avatars are hand-painted, not generated — and the frame is
  drawn once, not per character.** The old inline-SVG stained-glass roundels
  had "shapes don't match up" problems by nature: 22 characters each getting
  their own hand-built frame geometry. Now there's exactly one frame — a
  pointed Gothic arch defined as a single SVG path (`src/lib/gothicArch.ts`),
  applied as a CSS `clip-path` by `Avatar.svelte` — so the frame can't drift.
  Source art is a plain 1000x1500px rectangle, no transparency required
  (classic Paint doesn't handle alpha well); the app does the clipping.
  `design/avatar-template.png` is a generated guide showing exactly where
  the arch falls. Un-painted characters fall back to a candle glyph.
- **Debug/simulator mode shows each bot's *real* player screen, in tabs.**
  Extracted the play route's markup into `PlayerView.svelte` (props:
  `session`, `gameId`) so both `/play/[gameId]` and `/dev` render the exact
  same component — the simulator is no longer a summarized/abstracted view
  of a bot's state, it's the literal UI a guest's phone would show. Tabs are
  kept mounted and toggled with the `hidden` attribute rather than
  destroyed/recreated, so a bot's in-progress state (a typed meet reason,
  etc.) survives switching tabs.
- **Pale "monastery by day" is now the default theme**, not a
  `prefers-color-scheme` fallback — matches the brief (limestone, red
  sandstone, gilt, brighter than the previous nocturnal default). Dark
  "night vigil" is an explicit toggle (candle button, persisted per device
  via `localStorage`), not inferred from the OS setting. Real photo textures
  layer in via CSS `background-image` over a matching gradient, so the app
  looks intentional immediately and gets more textured as files are added to
  `static/textures/` — nothing breaks in the meantime.

## 2026-09-02 — Circle, Storyteller tools, simulator

- **Simulator at `/dev`** — one screen drives a whole game: the Storyteller on
  the main client plus N fake players, each its own in-memory Supabase client.
  Verified end to end against a live project: role dealing, clock sync across all
  panels, neighbour recalculation on death, meet queue.
- **Two bugs found and fixed via the simulator:**
  1. Sim clients shared the default auth `storageKey`, so a bot's anon token
     overwrote the Storyteller's session and every Storyteller write silently
     failed RLS. Fix: unique `storageKey` + no-op storage per sim client.
  2. Supabase query builders are lazy — a call that isn't `await`ed never runs.
     Several fire-and-forget handlers did nothing. Fix: await every mutation.
- **Anon sign-in rate limit** (Supabase free tier) is real. The simulator now
  keeps one pool of signed-in identities and reuses it across rebuilds.
- `seats` stays readable by all participants; the secret character lives in
  `seat_roles` (RLS: own seat or Storyteller). `player_notes` is private even
  from the Storyteller.
- Circle rendering: absolutely-positioned chips on an `aspect-ratio: 1` ring,
  seat 0 at top. `livingNeighbours` walks the ring skipping the dead.

## 2026-09-02 — Foundations vertical slice

- **SvelteKit** scaffolded via `npx sv create` (minimal + TS). Current toolchain
  is bleeding-edge: Svelte 5.56, SvelteKit 2, Vite 8, TypeScript 6, and the
  newer setup with **no `svelte.config.js`** — config lives in the `sveltekit()`
  plugin options inside `vite.config.ts`.
- **adapter-static, SPA mode** (`fallback: 'index.html'`, `ssr = false`
  globally). No server runtime; deployable to any static host; cacheable
  on-device — which is the point, given venue wifi.
- **Phase changes go through SQL RPCs** (`set_phase`, `pause_phase`,
  `resume_phase`, `adjust_duration`, `set_gather`), not client writes, so
  `phase_started_at` and pause math use the server's `now()`. The client never
  writes a timestamp. `clock.ts` pure functions are kept for computing *what*
  the next phase is and for tests.
- **`server_now()` RPC** returns epoch-ms; the client samples it a few times and
  keeps the least-noisy round trip (`bestOffset`).
- Slice verified: `npm run check` (0 errors), `npm test` (19 pass), `npm run
  build` (static output). Landing + host + play screens render; realtime clock
  path is coded but needs a real Supabase project to exercise end to end.

## 2026-09-02 — Foundations kickoff

- **Stack: SvelteKit PWA + Supabase.** Rationale in the brief §3. The deciding
  factor is venue connectivity — a cached client-rendered PWA degrades
  gracefully where a server-rendered app (FastAPI/NiceGUI) shows a blank screen
  on a dropped connection. Trade-off accepted: some TypeScript instead of all
  Python.
- **Auth: Supabase anonymous sign-in.** One anon user per device; the join link
  is the only credential. Acceptable for a wedding among friends; not hardened.
  Cross-player secrecy is enforced by row-level security, not by the UI.
- **Clock: server stores `started_at / duration / paused`; clients compute the
  countdown** against a one-time measured offset. No ticking value is ever
  transmitted.
- **Secret role assignment is split into its own table (`seat_roles`)** so RLS
  can hide it while `seats` stays readable by all participants.
- **Player notes are private even from the Storyteller** (`player_notes` RLS is
  `owns_seat` only). Matches the brief's "never shared".
- **Scripts are data files, not code.** `Script` / `Character` types in
  `types.ts`; Trouble Brewing is the first. Night-order integers in
  `trouble-brewing.ts` are a hand-entered first pass and must be checked against
  the official night sheets / community script-tool JSON before they're trusted.
- **Nominations & voting happen in person.** The app logs them (`day_log`) and
  gives each player a private prime-suspect marker; it does not run votes.
- **Character art: placeholders** until late in the build.

## Open questions

- Exact party date (assumed ~Sept 2027).
- Which script for the wedding — depends on expected player numbers. Trouble
  Brewing + Travellers is the fallback for a large, fluid crowd.
- Whether to adopt the community script-tool JSON format wholesale for character
  data import.
- Push-notification reliability for the gather signal on locked phones — needs
  real-device testing.
