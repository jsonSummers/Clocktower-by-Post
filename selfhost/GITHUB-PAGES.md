# Deploying the frontend to GitHub Pages

The app was already a static SPA build (`adapter-static`, `vite.config.ts`)
before this — GitHub Pages needed two small things on top, both now done:

- `vite.config.ts` reads a `BASE_PATH` env var for SvelteKit's `paths.base`,
  since a GitHub Pages *project* page is served from
  `https://<you>.github.io/<repo>/`, not the domain root.
- `src/lib/textureVars.ts` (new) re-sets the CSS texture custom properties
  (`--stone-tex` etc.) from JS with that base prefix baked in — the raw
  `url('/textures/...')` values in `app.css` are root-relative and can't be
  fixed by SvelteKit's routing, since it's plain CSS. Two component-level
  hardcoded paths (`Avatar.svelte`'s skull image, the `/dev` page's "Open ST
  page" link) were switched to use `$app/paths`'s `base` too.

None of this needs touching again unless you add a new absolute `/...` path
somewhere — from here on, use `{base}/...` (Svelte) or go through
`textureVars.ts` (CSS) for anything new under `static/`.

## One-time repo setup

Checked directly rather than assumed: this repo already has a GitHub
remote — `origin` is `https://github.com/jsonSummers/Clocktower-by-Post.git`,
branch `main`, with real commit history already pushed. So there's no repo
to create — just changes to get onto it.

### 1. Commit and push today's changes

`git status` on Rosemary right now shows a fair pile of *pre-existing*
uncommitted changes (deleted preview PNGs under `Claude outputs/` and
`design/tests/`, a modified `README.md`/`db/schema.sql`) sitting alongside
everything from this session (the workflow file, `textureVars.ts`, the
`vite.config.ts`/`Avatar.svelte`/`dev/+page.svelte`/`scriptTheme.ts`/
`+layout.svelte` edits, `selfhost/`, `cloudflared/`, `.gitignore`). None of
it is on GitHub yet — the Actions workflow only exists once it's actually
pushed to `main`, so this is the real first gate, not GitHub settings.

In a real terminal on Rosemary (PowerShell or WSL):

```
cd E:\Claude\Personal\BOTC
git status
```

Two options, your call:

**Commit everything currently pending** (simplest, bundles today's work
with the older pending changes):

```
git add -A
git commit -m "Add GitHub Pages deploy workflow and base-path fixes"
git push
```

**Or commit only today's GitHub Pages work**, leaving the older pending
changes staged-but-uncommitted for later:

```
git add vite.config.ts src/lib/textureVars.ts src/lib/components/Avatar.svelte src/routes/dev/+page.svelte src/lib/scriptTheme.ts src/routes/+layout.svelte .github/workflows/deploy-pages.yml selfhost/ cloudflared/ .gitignore
git commit -m "Add GitHub Pages deploy workflow and base-path fixes"
git push
```

### 2. Turn on Pages

`github.com/jsonSummers/Clocktower-by-Post` → **Settings** tab → **Pages**
in the left sidebar → under "Build and deployment", set **Source** to
**GitHub Actions** (a dropdown — the default is "Deploy from a branch",
which is the wrong option here; the workflow does its own build and
deploy, it doesn't need a `gh-pages` branch).

### 3. Add the two secrets

Same **Settings** tab → **Secrets and variables → Actions** in the left
sidebar → **New repository secret**, twice:

- Name `PUBLIC_SUPABASE_URL`, value copied from your local `.env`'s same
  key (cloud Supabase now, or the self-hosted tunnel URL later).
- Name `PUBLIC_SUPABASE_ANON_KEY`, value copied the same way.

Secret values are write-only in the GitHub UI after saving (you'll just
see the name listed, not the value) — that's normal, not a sign it failed.

### 4. Trigger the deploy

The `git push` in step 1 already triggers it, since the workflow runs on
every push to `main`. To re-run without pushing (e.g. after rotating a
Cloudflare Quick Tunnel URL): repo → **Actions** tab → **Deploy to GitHub
Pages** in the left sidebar → **Run workflow** button → branch `main` →
**Run workflow**.

### 5. Watch it, then check the site

Actions tab shows the run — a yellow dot while building, green check when
done (a couple of minutes for a project this size). Click into the run if
it goes red to read the build log.

Once green, **Settings → Pages** shows "Your site is live at ...". The URL
is `https://jsonsummers.github.io/Clocktower-by-Post/` — GitHub always
lowercases the *username* part of the subdomain, but keeps the repo name's
exact case in the path, so the capital C and P stay. Open it, confirm the
textures/frames render (that's the part this session could only
type-check, not actually see), then join from a second browser profile or
your phone to check it plays end to end.

### If it fails

- Deploy step fails specifically (not the build step): Pages likely isn't
  set to "GitHub Actions" yet — go back to step 2.
- Site loads but shows "Supabase isn't configured": one or both secrets
  are missing or misnamed — check **Settings → Secrets and variables →
  Actions** lists both exact names from step 3.

## Backend pairing — pick one

GitHub Pages only serves the static frontend; it has no idea what backend
you point it at. Two genuinely free combinations:

- **Cloud Supabase (current setup)** — zero extra moving parts, zero
  rebuild ritual. Already has known free-tier egress/Realtime caps (see the
  2026-09-17 project doc entry) — fine for the real event's traffic, worth
  watching during heavy `/dev`-simulator playtesting.
- **Self-hosted on Rosemary + Cloudflare Quick Tunnel** — see
  `selfhost/SETUP.md`'s new "free alternative" section. No caps, no cloud
  dependency, but the tunnel URL changes each time it restarts, so you
  update the `PUBLIC_SUPABASE_URL` secret and re-run this workflow before
  each event.

Named Cloudflare Tunnel + your own domain (the rest of `selfhost/SETUP.md`)
is still there if you'd rather have a permanent, stable URL later — it's
the only option here that isn't free, but it's also the only one that
never needs a pre-event refresh.
