# Clocktower by Post

An async companion app for **Blood on the Clock Tower**, built for playing across a
wedding reception — people plot, deduce and mingle in person while the app carries
the day/night clock, private night information, the seating circle, and the
Storyteller's tools.

Design brief: [`design/brief.html`](design/brief.html) · [published version](https://claude.ai/code/artifact/b61eaa2a-f510-418e-9d7c-aeea0cccb58e)

> Private project. Not affiliated with The Pandemonium Institute. No official
> character art or ability text ships in this repo.

---

## Status

**Foundations working, verified against a live Supabase project.**
`npm run check`, `npm test` (31), and `npm run build` are all green.

| Part | File | State |
|---|---|---|
| Synced-clock logic | [`src/lib/clock.ts`](src/lib/clock.ts) | done + 19 unit tests |
| Circle / neighbours logic | [`src/lib/circle.ts`](src/lib/circle.ts) | done + 12 unit tests |
| Team composition table (5–15) | [`src/lib/scripts/composition.ts`](src/lib/scripts/composition.ts) | done |
| Trouble Brewing script data | [`src/lib/scripts/trouble-brewing.ts`](src/lib/scripts/trouble-brewing.ts) | first pass — night order needs verifying |
| Laissez un Faire script data | [`src/lib/scripts/laissez-un-faire.ts`](src/lib/scripts/laissez-un-faire.ts) | first pass — night order and a few abilities (Cannibal, Lunatic, Leviathan's win condition) are Storyteller-run/manual by design, see the file's own header |
| Per-script visual theme (gothic / Victorian-occult) | [`src/lib/scriptTheme.ts`](src/lib/scriptTheme.ts), [`src/app.css`](src/app.css) | done — Trouble Brewing keeps the pale monastery/night-vigil theme, Laissez un Faire gets a Lovecraftian "old leather book" theme (deep leather/damask, cult-sigil iconography, small tarnished-brass accents); textures via [`scripts/make_lovecraft_textures.py`](scripts/make_lovecraft_textures.py) |
| Shared Gothic-arch clip, per-script decoration (warding sigil; hand-painted candle/skull altar overlay at every size) | [`src/lib/eldritchFrame.ts`](src/lib/eldritchFrame.ts), [`src/lib/candleDeco.ts`](src/lib/candleDeco.ts) | done, decoration only — no Laissez un Faire character art painted yet |
| Database schema + RLS + RPCs | [`db/schema.sql`](db/schema.sql) | done, running on a project |
| Live game session | [`src/lib/game.svelte.ts`](src/lib/game.svelte.ts) | game + seats + roles + meet requests over realtime |
| Landing / Storyteller / Player screens | `src/routes/` | done for this stage |
| Circle, info drawer, meet queue | `src/lib/components/` | done |
| **Simulator** | [`src/routes/dev/+page.svelte`](src/routes/dev/+page.svelte) | drive a whole game with fake players, each in a tab showing their *real* player screen |

Working now: create/join, the synced clock across every device, seating circle
with live neighbour recalculation, Storyteller seating + role assignment + notes,
a player role card, the info drawer, "ask to see the Storyteller" with a queue,
and full seat lifecycle control — a player can **leave their own seat**, and the
Storyteller can **remove someone from a seat** or **reorder the circle**
(`leave_seat` / `kick_seat` / `move_seat` RPCs in `db/schema.sql`). Character
portraits have a frame (a shared gothic-arch clip shape, `Avatar.svelte`) and a
placeholder candle glyph, ready for hand-painted art — see
[`docs/avatars.md`](docs/avatars.md). Both scripts clip through the same Gothic
arch; the page's colours/textures and the frame's *decoration* switch per script
instead -- every avatar, at every size, now gets a small altar overlay painted
from Mickey's own art (`design/candles.png`, `design/skull.png`, processed by
[`scripts/process_altar_art.py`](scripts/process_altar_art.py) into
`static/textures/candle-church.png` / `candle-lovecraft.png` / `skull.png`),
standing on a short, window-wide brick altar shelf
([`scripts/make_altar_brick.py`](scripts/make_altar_brick.py) →
`static/textures/altar-brick*.jpg`, one brick-bond palette per script/day-night
combination). Trouble Brewing games get the warm-flame candles bottom-left, with
an animated translucent orange glow behind the flames; Laissez un Faire games
get the same candle art recoloured to a lighter charcoal wax with a blue flame
(and a matching blue glow) bottom-left, plus a skull bottom-right, alongside the
Lovecraftian old-leather-book look and the warding sigil at the arch's keystone
(`src/lib/scriptTheme.ts`, `src/lib/eldritchFrame.ts`, `src/lib/candleDeco.ts`).
Laissez un Faire portraits can go straight onto the same plain 1000x1500px
template once painted, no new plumbing needed. Still to come: day log, private
notes.

**Needs a Supabase project** (next section) — without one the app loads but shows
a "not configured" banner.

---

## Getting set up

Node.js is already installed (v24). The remaining setup is Supabase.

### Create a Supabase project

1. Sign up at <https://supabase.com> (free tier is plenty).
2. New project → pick a name and a strong database password → wait for it to
   provision.
3. **SQL Editor → New query** → paste all of [`db/schema.sql`](db/schema.sql) →
   Run. This creates every table, the security policies, and the helper
   functions.
4. **Authentication → Providers → Anonymous** → enable it. Devices sign in
   anonymously; there are no passwords.
5. **Project Settings → API** → copy the *Project URL* and the *anon public*
   key.

### Environment variables

```bash
cp .env.example .env
```

Then paste your URL and anon key into `.env`.

### Starting fresh / re-applying the schema

`db/schema.sql` is written to be safe to re-run any time — the top of the file
drops every table and function first, then recreates them. This is also how
you pick up schema changes (like the seat-lifecycle RPCs added for the lobby
rework): **you don't need a new Supabase project** — just open the same
project's **SQL Editor → New query**, paste the current `db/schema.sql`, and
run it again.

A couple of things that re-running does *not* touch, so you don't need to redo
them:

- **Anonymous auth stays enabled.** That setting (and the anon accounts
  themselves) live outside the `public` schema that `schema.sql` drops.
- **Your `.env` keys stay valid.** The project URL and anon key don't change
  just because the tables underneath were rebuilt.

Re-running genuinely deletes all game data (there's no real game history to
lose yet at this stage). If you ever do want a completely new project instead
— a fresh URL and keys, e.g. to hand the app to someone else's Supabase
account — repeat "Create a Supabase project" above from step 1 and update
`.env` to match.

### Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # clock unit tests
npm run check      # type-check
npm run build      # static build into ./build
```

> On the first `npm install`, npm 11 prints a warning that `esbuild`'s install
> script wasn't run (a new supply-chain guard). It's harmless here — the build
> works — but to clear it: `npm approve-scripts esbuild`.

### Try it — the simulator

Open **`http://localhost:5173/dev`** and click **Build game**. It spins up a
game with fake players and a Storyteller panel, all on one screen. From there:

- **Deal roles** — hands out a Trouble Brewing set for the seat count
- **Advance to Night 1** — every panel's clock starts counting down together
- **Player screens** — one tab per bot, and each tab is that seat's *actual*
  player screen (role card, avatar, circle, ask-to-meet, leave-seat) — click
  through them to test the real UI a guest would see, not a summary of it
- The small ♥ / ✝ on each tab kills or revives that bot without leaving the
  tab strip
- **Open ST page ↗** — the real Storyteller screen for the same game, where
  you can also try the seat **move**/**remove** controls on the Seats tab

> **Supabase rate limit:** the free tier throttles new anonymous sign-ins. The
> simulator reuses one pool of identities across rebuilds, but if you reload the
> page a lot you may hit `Request rate limit reached`. Wait a few minutes, or
> raise it in Supabase → Authentication → Rate Limits.

### Try it with two real devices

1. `http://localhost:5173` → **Create game** → Storyteller page with a 4-letter code.
2. On your phone (same wifi, your computer's LAN IP, e.g. `http://192.168.1.x:5173`)
   → enter the code and a name → **Join**.
3. Storyteller: **Advance to Night 1**. Both screens count down together.

---

## How the clock works

The server stores only *when* a phase started, how long it should run, and
whether it's paused (see `phase_*` columns on `games`). Each device computes its
own countdown from those values, corrected by a one-time estimate of how far its
clock differs from the server's (`server_now()` RPC + `measureOffset()`).

A brief disconnect changes nothing — the device already knows when the phase
ends. Only the Storyteller's device needs a steady connection, and even that can
lag without breaking anyone else. All of this logic is pure and lives in
[`src/lib/clock.ts`](src/lib/clock.ts).

## Look & feel

The theme (`src/app.css`) is a pale 15th-century scriptorium/monastery by
default — limestone, red sandstone, gilt, vellum — with a dark "night vigil"
variant behind the candle button in the top corner (a deliberate toggle, not
tied to the OS light/dark setting). Real photo textures are optional and
layer in automatically the moment you drop files into `static/textures/` —
see [`static/textures/README.md`](static/textures/README.md) for exact
filenames and where to find free, seamless ones (ambientCG, Poly Haven,
3dtextures.me). Character portraits are hand-painted stained-glass windows in
a shared gothic-arch frame — see [`docs/avatars.md`](docs/avatars.md) for
canvas size and workflow.

## Project layout

```
.github/workflows/ GitHub Pages deploy workflow (deploy-pages.yml)
archive/           retired code from the pre-Supabase artifact prototype (reference only)
cloudflared/       Cloudflare Tunnel config template, for a self-hosted backend
design/            the design brief + design/avatar-template.png (painting guide)
db/schema.sql      full Postgres schema + RLS + RPCs, for the Supabase SQL editor
docs/              decision log + avatars.md (how to paint the character portraits)
selfhost/          self-hosting Supabase + GitHub Pages walkthroughs (SETUP.md, GITHUB-PAGES.md)
static/
  avatars/         character portraits go here as <character-id>.png — see docs/avatars.md
  textures/        optional real photo textures for the theme — see textures/README.md
src/
  app.css          global theme — pale "monastery by day" by default, a candle-button
                    toggles a dark "night vigil" variant (src/routes/+layout.svelte)
  routes/
    +page.svelte                 landing — create or join a game
    host/[gameId]/+page.svelte    Storyteller: Clock / Seats / Requests tabs
    play/[gameId]/+page.svelte    player: thin wrapper around PlayerView
    dev/+page.svelte              the simulator — Storyteller panel + a real PlayerView per bot
  lib/
    clock.ts         synced-clock logic (pure, tested)
    circle.ts        living-neighbours + seat layout (pure, tested)
    gothicArch.ts     the one arch shape every avatar is clipped to
    server-time.ts   measures this device's offset from the server clock
    phase.ts         games row  ->  PhaseState
    game.svelte.ts   live game session: realtime subscription + ticking clock
    actions.ts       thin wrappers around the writes each screen makes
    supabase.ts      main client + anonymous sign-in + throwaway sim clients
    types.ts         shared domain + database row types
    scripts/         script definitions and the composition table
    components/      Circle, ClockFace, InfoDrawer, Avatar, GothicDefs, PlayerView
```

## Deploying

The app is a static SPA build (`adapter-static`) — deployable to any static
host, no server runtime needed. It's a PWA too, so on a phone it installs to
the home screen from the browser's share menu regardless of which of these
you use.

**Vercel** — push to a GitHub repo, import it at <https://vercel.com>, add
the two `PUBLIC_SUPABASE_*` environment variables in the project settings.
Every push then deploys.

**GitHub Pages** — free, via `.github/workflows/deploy-pages.yml` (builds
and deploys automatically on push to `main`, or manually from the Actions
tab). One-time setup (enable Pages, add the two `PUBLIC_SUPABASE_*` repo
secrets) and troubleshooting: [`selfhost/GITHUB-PAGES.md`](selfhost/GITHUB-PAGES.md).

**Backend**: either points at a Supabase project (cloud free tier, as set up
above) or a self-hosted one on your own machine, tunnelled out with
Cloudflare (no port-forwarding, works from any network — not just shared
venue wifi) — including a genuinely free no-domain option (Cloudflare Quick
Tunnel). Walkthrough: [`selfhost/SETUP.md`](selfhost/SETUP.md).
