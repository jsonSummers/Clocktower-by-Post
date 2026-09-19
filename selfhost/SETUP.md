# Self-hosting Supabase on Rosemary + Cloudflare Tunnel

Goal: swap the cloud Supabase project for one running on Rosemary, reachable
from any network (not just shared party wifi) via a Cloudflare Tunnel. The
app itself needs zero code changes — it's a drop-in swap of
`PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` in `.env`.

This doc can't be executed from a Claude session — Docker and the tunnel
have to run on your real Windows machine (Docker Desktop / a real terminal),
not the sandboxed bridge Claude reaches. Everything below is copy/paste for
you to run yourself, in order.

## 0. Prerequisite: a domain on Cloudflare's nameservers

You don't have one yet — cheapest realistic path:

1. Register a cheap domain. Options that run roughly £5-12/year: Cloudflare
   Registrar (at-cost, no markup, but only for domains already eligible —
   check cloudflare.com/products/registrar), or Porkbun/Namecheap for a
   `.com`/`.dev`/`.uk` etc. A `.uk` or a less common TLD is usually the
   cheapest.
2. Add the domain as a site in the Cloudflare dashboard (free plan is
   fine) — dash.cloudflare.com → Add a site.
3. Cloudflare gives you two nameservers. Set those as your domain's
   nameservers at whichever registrar you bought it from (their DNS/
   nameserver settings page, not Cloudflare's).
4. Wait for Cloudflare to email that the zone is active — usually minutes,
   sometimes a few hours.

Once that's done, everything below can use `botc.yourdomain.com` (pick any
subdomain you like) as the public hostname.

## 1. Bring up self-hosted Supabase locally first (no tunnel yet)

In a real terminal on Rosemary (PowerShell, or WSL if you have it):

```
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
copy .env.example .env
```

Generate secrets into that `.env`:

- `POSTGRES_PASSWORD` and `JWT_SECRET`: any random 32+ char string, e.g.
  `openssl rand -hex 32` (Git Bash / WSL has `openssl`; PowerShell doesn't
  by default).
- `ANON_KEY` / `SERVICE_ROLE_KEY`: these are JWTs signed with your
  `JWT_SECRET` — use Supabase's own generator so the claims are right:
  https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`: whatever you want, this
  gates the Studio UI.

Then:

```
docker compose pull
docker compose up -d
```

Check http://localhost:8000 — that's Kong, the gateway (also serves
Studio). Log in with the dashboard credentials you set. Leave it running.

**Never reuse the `service_role` key anywhere in the SvelteKit app** — only
`ANON_KEY` goes in the app's `.env`, same rule as the cloud setup.

## 2. Point the app at it, test on the same network first

In the BOTC repo's own `.env`:

```
PUBLIC_SUPABASE_URL=http://<rosemary's LAN IP>:8000
PUBLIC_SUPABASE_ANON_KEY=<the ANON_KEY from step 1>
```

Run `db/schema.sql` against this new instance via the Studio SQL editor
(same file you already use for the cloud project) to create the game
tables. `npm run dev -- --host`, join from another device on the same
wifi, confirm a game actually plays through this backend before touching
the tunnel.

## 3. Cloudflare Tunnel — expose it publicly

```
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create botc
cloudflared tunnel route dns botc botc.yourdomain.com
```

Edit `cloudflared/config.yml` in this repo (template already here) with
your real tunnel ID and domain, then:

```
cloudflared tunnel --config cloudflared/config.yml run botc
```

Leave that running alongside `docker compose up -d`. `botc.yourdomain.com`
now reaches Kong on Rosemary from anywhere with internet — no port
forwarding.

Finally, switch the app's `.env` (and Vercel's env vars, if still using
Vercel for the frontend) to:

```
PUBLIC_SUPABASE_URL=https://botc.yourdomain.com
PUBLIC_SUPABASE_ANON_KEY=<same ANON_KEY as above>
```

## 4. On the day

Two things need to be running on Rosemary: `docker compose up -d` (in
`supabase/docker`) and `cloudflared tunnel run botc`. If venue wifi is
unreliable, this setup doesn't actually need guests on the same network at
all — the tunnel makes it reachable over their own cellular data too. A
phone hotspot is only needed as a fallback if Rosemary itself has no
internet path out.

## Known trade-offs (carried over from earlier scoping)

- No built-in backups, manual update scripts, thinner observability than
  the managed product.
- Traffic rides Rosemary's home upload bandwidth, not a datacenter's —
  check a real upload-speed number before leaning on this for the actual
  event.
- Official minimums: 8GB+ RAM / 4+ cores / 80GB+ SSD — comfortably inside
  the 3090 rig's specs.

## Free alternative to a named tunnel: Cloudflare Quick Tunnel

If you don't want to buy a domain at all, `cloudflared` has a zero-setup
mode that needs no Cloudflare account, no login, no domain:

```
cloudflared tunnel --url http://localhost:8000
```

This prints a random `https://something-random.trycloudflare.com` URL that
proxies straight to Kong on Rosemary — genuinely $0, works immediately.
The catch: the URL changes every time you start it (it's meant for
short-lived use, not a permanent address), so it doesn't suit a
"set it once and forget it" deployment.

For an occasional single-event app like this, that's a fine trade: before
the party, start the quick tunnel, copy its URL into the
`PUBLIC_SUPABASE_URL` repo secret (GitHub → Settings → Secrets and
variables → Actions), then re-run the `Deploy to GitHub Pages` workflow
(Actions tab → **Run workflow**) — a couple of minutes, done once per
event, not something you maintain day to day.

If that ritual is annoying, the fix is a small code change: read
`PUBLIC_SUPABASE_URL` at runtime (e.g. from a query param the host sets
once and shares via the join link/QR code) instead of baking it in at
build time. Not built — ask if you want it; it removes the
rebuild-before-each-event step entirely and works with either tunnel mode.
