# Decision log

Short records of choices that would otherwise be hard to reconstruct. Newest first.

## 2026-09-11b — realtime self-healing, win-condition/voting helpers, gothic portrait grade

Four fixes/features from the same round of live testing, in response to:
"the player has to keep refreshing the page to get updates... perhaps we
also need a notification", "I tried to just have a game with one seat, a
demon, and no win screen came up", and portrait feedback ("moodier, gothic
in colour", "black lines... still have some gaps... can become very gray
due to the light reflection").

- **Realtime refresh bug, root-caused and fixed pragmatically.** Extensive
  live testing against the deployed site (fresh page loads, isolated replica
  channels mimicking the app's exact subscription pattern, REST reads used
  to independently confirm DB writes were succeeding while the UI stayed
  stale) established that Supabase Realtime `postgres_changes` delivery to
  this app's channel is genuinely unreliable in a way that doesn't map to
  one fixable bug in our code — RLS and the publication list are correct,
  writes succeed, but delivery back to the subscriber intermittently doesn't
  happen, without ever firing `CHANNEL_ERROR`/`TIMED_OUT`. Rather than keep
  chasing Supabase-internals blind, `GameSession` (`src/lib/game.svelte.ts`)
  now treats realtime as a nice-to-have accelerant, not the source of truth:
  a `.subscribe((status) => ...)` callback drives reconnect-with-backoff on
  `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`, AND — the actual guaranteed fix,
  independent of channel health — a `setInterval(() => this.refreshAll(),
  4000)` polls every table regardless of whether the channel claims to be
  live. Each `refresh*()` now only applies new state (and bumps a new
  `lastChangeAt` timestamp) when the fetched data's signature actually
  differs from what's cached, so the 4s poll doesn't cause visible flicker
  on every tick. `realtimeStatus` (`connecting`/`live`/`reconnecting`/
  `polling`) is exposed for the UI.
- **Lightweight in-app notification**, the user's suggested complement to
  the above (native browser Notifications were deliberately skipped — not
  worth the permission-flow complexity for this). `ClockFace.svelte` shows a
  small live/reconnecting status dot next to the phase label and briefly
  pulses the clock face + an "Updated" tag whenever `lastChangeAt` changes
  (skipping the very first value, so page load doesn't pulse). `PlayerView.svelte`
  goes further for the highest-value case — new night info arriving: it
  reuses the existing `buzz()` (vibrate + soft tone, already used for the
  gather signal) whenever the player's own `night_actions` row changes after
  the initial page load, plus a "New" badge and a brief highlighted border on
  the Tonight card.
- **`grimoire` was missing from the `supabase_realtime` publication** in
  `db/schema.sql` (found while auditing the publication list during the
  above) — the Fortune Teller red-herring feature added last session could
  fetch on load but would never get live updates. Added; requires
  re-running `db/schema.sql`.
- **Win condition and voting-rules helpers** (`src/lib/scripts/winCondition.ts`,
  new, with `winCondition.test.ts`). Confirmed by grep that none of this
  existed at all before — only `seat.alive` toggling, no win check, no vote
  math, and `ghost_vote_available` was a schema column nothing ever read or
  wrote. Scope was deliberately kept to computed helpers on the Storyteller's
  screen rather than a full digital nomination/ballot UI, matching the app's
  existing "doesn't replace in-person talk" design (nominations/votes/
  executions already happen in person via the existing manual Alive/Dead
  toggle). `checkWinCondition()` implements the two script-agnostic Trouble
  Brewing conditions — good wins once no living seat holds a Demon-team
  character (gated on roles actually being dealt, so an empty lobby doesn't
  read as "good wins"), evil wins once only two seated players are left
  alive — and is surfaced as a banner on the host page (visible on every
  tab) with an "Announce & end game" button that sets `phase_kind='ended'`
  (an existing, already-modelled but previously unused phase state) via the
  existing `set_phase` RPC — no schema change needed for this part.
  `voteState()` computes the official majority threshold (`floor(alive/2)+1`)
  and lists dead seats with an unused ghost vote; both surface in a new
  "Voting" card on the Seats tab. `setSeatAlive()` now resets
  `ghost_vote_available` to true whenever a seat is marked dead (a fresh
  ghost vote on death, per the rules), and a new `setGhostVoteAvailable()` +
  per-seat toggle button let the Storyteller mark a ghost vote used. Script-
  specific extra win conditions (e.g. "evil also wins if the Saint is
  executed") are deliberately NOT automated — still a Storyteller call, same
  as nominations/votes themselves.
- **Portrait pipeline v7** (`scripts/stained_glass.py`), addressing both
  portrait complaints together:
  - *Moodier, gothic colour*: new `_gothic_grade()`, applied to pane fills
    only (never the leading). Boosts saturation ~22% around each pixel's own
    luminance for richer jewel tones, adds a gentle S-curve contrast so
    shadows read as genuinely deep rather than flat/pastel, and works a
    faint cool indigo tint into just the darkest areas (fading out above
    ~35% luminance) — paired with the existing warm backlight glow, giving a
    warm-light/cool-shadow split that reads as atmospheric rather than
    flat-lit. New `mood_strength` param (default 1.0), `--mood-strength` CLI
    flag.
  - *Remaining gaps in the leading*: `find_leading()` previously relied
    entirely on `find_and_fill_gaps()` recolouring pale/neutral pixels back
    in, which only catches a gap if the missing pixels happen to read as
    pale — an antialiased or slightly tinted break doesn't qualify, and
    these were exactly the gaps still visible after the earlier v2 fix. v7
    adds `ndimage.binary_closing` directly on the boolean leading mask
    (`close_gap_iterations`, default 2) — a purely geometric fix that
    bridges small breaks regardless of the gap pixels' colour, without
    thickening or merging lines that are genuinely meant to stay separate
    (closing is idempotent on shapes already larger than the structuring
    element). Confirmed visually: the imp's horn/chain linework, which
    showed obvious dashed/broken segments under v6, is solid under v7.
  - *Lines turning grey under the reflection*: root cause found in
    `_finish_glass()` — the backlight glow and reflection streak blends were
    applied to the WHOLE window uniformly, including already-drawn leading
    pixels, so wherever a streak crossed the ink it lightened straight
    toward white/gold. Fixed by passing the `is_line` mask through and
    discounting (via `line_light_guard`, default 0.88 = ~12% of normal
    strength survives) both blends on leading pixels — the came's own
    dedicated ridge-highlight (a separate, deliberately thin catch-light
    already drawn earlier) still shows through, but the broad per-window
    glow no longer washes the ink out.
  - All 9 live avatars in `static/avatars/` regenerated with v7
    (`strength="strong"`, same defaults) and pushed to the device — same
    sync-gap risk as last time (script changes living only in the tool's
    scratch space until explicitly committed to disk) was checked for and
    avoided this time by committing the script itself before regenerating.

## 2026-09-11 — robust auto-deal, Night 1 evil-team recognition, Fortune Teller red herring

- **Auto-deal rewritten as a shared, correct module** (`src/lib/scripts/deal.ts`,
  `dealGame()`): the old `/dev`-only version always took the *first* N
  characters of each team in script-definition order (so Baron and Scarlet
  Woman could never be dealt at all) and never applied Baron's setup swing.
  The new version randomly draws which characters fill each team's slots,
  resolves minions first so a drawn Baron's +2 outsider/-2 townsfolk swing is
  known before townsfolk/outsiders are drawn, then shuffles the seat
  assignment. `applyDeal()` in `actions.ts` writes the result: replaces
  `seat_roles`, clears/re-sets the red herring flag, clears `night_actions`
  (a redeal starts night info fresh), and records the actual composition
  used on `games.composition`. Both `/dev`'s "Deal roles" and a new **"Deal
  random roles" button on the real Storyteller host page** (Seats tab) call
  the same module — no more dev-only feature gap.
- **Night 1 Demon/Minion mutual recognition**, modelled without any
  `night_actions` schema change (it's `unique(game_id, night, seat_id)` — one
  row per seat per night, a hard constraint). `nightInfo.ts` gains
  `night1EvilReveals()`: the Demon gets its Minions plus 3 not-in-play
  bluffs; each Minion gets the Demon and its fellow Minions. `wakeOrder()`
  now injects the whole evil team as synthetic first steps on Night 1 only,
  including characters that otherwise never get a night step at all (Scarlet
  Woman, Baron — `firstNight`/`otherNight` both null). In `NightDispatch.svelte`,
  how the reveal reaches a seat depends on whether that character already has
  a real Night 1 action: Spy (grimoire) / Baron / Scarlet Woman (none) / Imp
  (choose, but no kill on Night 1) send the reveal as the whole message via
  the existing info-send flow; Poisoner (choose, still poisons Night 1) gets
  the reveal folded into the `askNightChoice` ability text instead of a
  second row.
- **Fortune Teller red herring**: new `grimoire.is_red_herring boolean`
  column (Storyteller-only per existing RLS — safe for a secret, unlike
  `games`). `dealGame()` picks it from the dealt good (non-Demon,
  non-Minion) seats whenever a character flagged `redHerring: true` (now set
  on `fortune-teller` in `trouble-brewing.ts`) is in play. `GameSession`
  gains a `grimoire` state array (empty for a player's client — that's RLS
  working as intended, not a bug) and a `redHerringSeatId` derived. Once the
  Fortune Teller submits two picks, `NightDispatch.svelte` shows a "Send
  reading" button computing yes/no (either pick is the Demon or the red
  herring) and writes it back onto the *same* `night_actions` row by
  JSON-encoding `{picks, reading}` into `result` instead of the plain picks
  array — `parseChoiceResult()` in `nightInfo.ts` reads either shape. The
  same enriched-result pattern now also drives the **Ravenkeeper's
  reveal-after-pick** (sends back the picked seat's real character name).
- **Verification**: this sandbox still can't run `npm run dev`/`build`/
  `svelte-check` (Windows-built native Rollup binaries vs. this Linux VM —
  same limitation as prior sessions). Ran `tsc --noEmit` directly against
  every plain-TypeScript file touched (`deal.ts`, `nightInfo.ts`,
  `actions.ts`, `types.ts`, `composition.ts`, `trouble-brewing.ts`,
  `scripts/index.ts`) — clean, no errors. The `.svelte` files and
  `game.svelte.ts` (runes) can't be typechecked here without the full Vite
  toolchain; changes there were hand-verified against the existing file
  (brace-balance-checked) and follow established patterns exactly. Also
  fixed a small pre-existing bug found along the way: `/dev`'s "Roles in
  play" panel used `<Avatar>` without importing it.

## 2026-09-11 — night-vigil theme actually gets a dark stone/parchment texture

- **Root cause of "night mode only changes the text boxes, there isn't a
  night stone texture":** `--stone-tex` / `--parchment-tex` were only ever
  defined once, in the light-theme `:root` block, generated by
  `scripts/make_textures.py` from the *day* palette (pale limestone/
  parchment photos). `:root[data-theme='night']` never redefined them, so
  night mode silently reused the same pale images — the near-black night
  gradient in `app.css`'s `body` rule just painted over the pale photo
  instead of revealing a genuinely dark one, leaving `.card` panels (whose
  background-*color* does flip with the theme) as the only visible change.
- **Fix:** `make_textures.py` gained `limestone_night()` / `parchment_night()`
  — same coursed-masonry/vellum-grain construction, built from the night
  palette instead (`NIGHT_BG`/`NIGHT_SURFACE`/`NIGHT_BORDER`, lifted a bit
  above the literal CSS token values so the blend still reads as textured
  stone rather than crushing to a flat near-black square), with mortar
  joints picking up a faint warm candlelight-gold highlight rather than a
  plain darken. `:root[data-theme='night']` in `app.css` now overrides
  `--stone-tex`/`--parchment-tex` to the two new images
  (`static/textures/limestone-night.jpg` / `parchment-night.jpg`).
- Verified by reproducing the bug live on the deployed site first (toggling
  night vigil showed exactly the flat/textureless background reported),
  then confirming the new images read as genuinely stone/parchment-grained
  on their own before wiring them in.
- Also QA'd multiplayer joining, the meet-request queue, and night dispatch
  end-to-end against the live Vercel deployment. One thing NOT a bug: two
  "different" incognito/private windows in the same private-browsing
  session share the same storage partition (and therefore the same anon
  Supabase session), so `join_game`'s idempotent-per-device behaviour
  correctly treats the second join as "already in this game" and just
  renames the existing seat — this is the intended behaviour for a
  returning player, not a collision bug; it only looks like one when
  testing multiple "players" from windows that actually share storage.
  Two real gaps found while checking "does red herring etc. work":
  the red-herring/evil-team-introduction step from the old Artifact
  prototype was never ported to this build (already flagged as an open
  gap in the project doc), and the composition-aware **auto-deal-roles**
  button only exists on the `/dev` simulator — the real Storyteller page
  has no equivalent, only per-seat manual character assignment.

## 2026-09-10b — stained-glass v6: thicker textured stone border, per-pane reflection, Empath

- **`_stone_border()` thickened and textured** per feedback ("a bit thicker
  with a stone texture"): `thick_frac` 0.032 → 0.050, plus fine grain and a
  few weathering blotches layered onto the existing mottle. The part that
  actually reads as *built* rather than painted is new coursed seams —
  thin dark lines crossing the border at even intervals all the way round,
  like real ashlar voussoirs framing a window. They're keyed to a new
  `_arclen_map()` (nearest-point-on-outline lookup via
  `distance_transform_edt(..., return_indices=True)` against a densely
  resampled `_arch_outline()`), so the coursing always lands evenly around
  the arch regardless of size/aspect rather than being hand-fit to the
  bezier curves. `gothic_arch_mask()` now delegates to the same
  `_arch_outline()` helper — one outline definition, two consumers.
- **Reflection moved from one whole-window streak to per glass pane**, per
  feedback ("identify glass regions... apply the reflection per glass
  panel"). `_depth_and_gloss()` renamed to `_finish_glass()`; the global
  depth vignette and backlight glow stay (one light source, one recessed
  frame — physically right to keep global), but the specular glass-glare
  is now computed per connected pane (reusing the `labels` the inner
  glow/mottle pass already grouped panes by): each pane above a minimum
  area gets its own small diagonal catch-light at a randomised (seeded per
  pane) angle/position, confined to actual glass pixels — never the lead,
  never the stone. Real leaded glass is dozens of individually-set facets;
  one streak across the whole window read as a sticker on a flat sheet,
  where per-pane highlights read as actual glasswork. New `reflection` /
  `pane_gloss_strength` (default 0.24) params, `--no-reflection` /
  `--pane-gloss-strength` on the CLI.
- **Empath painted and processed** — the first new character since Monk/
  Scarlet Woman. `id: 'empath'` was already present in
  `trouble-brewing.ts`, so no script-data change was needed; just ran it
  through the pipeline at `--strength strong` alongside a full re-run of
  the other seven (border + reflection changes touch every pixel, so all
  eight got regenerated together and reviewed as one labelled 4×2 grid on
  the actual card background before pushing).
- **`static/avatars/{washerwoman,librarian,poisoner,imp,chef,monk,
  scarlet-woman,empath}.png`** all live. Also folded in a documentation
  gap: the v5.1 light/reflection strengthening (below) had been coded and
  pushed previously but never got a decisions.md entry — added
  retroactively so the log matches what actually shipped.

## 2026-09-10 — stained-glass v5.1: stronger light-through-glass effect

- **`_depth_and_gloss()` extended** per feedback ("more glass like
  reflection... light coming through"): a second, softer catch-light streak
  on the opposite diagonal from the first (real photographed stained glass
  rarely shows just one reflection band), plus a broad soft backlight glow
  centred a little above the window's middle, screen-blended in — reads as
  daylight genuinely coming through rather than just a glint off the
  surface. Split into its own `light_strength` parameter (default bumped
  from 0.16 to 0.28 after an A/B check at 0.16/0.28/0.40 — 0.40 started
  washing out the linework in the upper panes) so it can be tuned
  independently of the depth vignette. `--light-strength` on the CLI.
- All seven avatars (pre-Empath) re-run at the new default and re-pushed.
  Superseded a day later by v6 above, which replaced this whole-window
  streak with per-pane reflections.

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
