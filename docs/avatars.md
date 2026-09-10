# Painting the character avatars

Every character gets one stained-glass window portrait, shown on a player's
own role card, in the Storyteller's seat list, and in the "how this works"
character reference. The app frames every one of them identically — a
pointed Gothic arch — so you only ever have to paint what's *inside* the
window, never the window itself.

## Why this fixes the old artifact's "shapes don't match up" problem

The earlier attempt (see the project notes) hand-built each portrait as
inline SVG, generating the frame and the art together per character — with
22 different characters, the frame geometry drifted a little each time.

This time the frame is drawn exactly once, in code
(`src/lib/gothicArch.ts`), as a CSS clip-path applied identically to every
avatar. Your job is only the picture behind it. There's no way for the
shapes to stop matching, because there's only one shape.

## What to paint

- **Canvas size: 1000 x 1500px** (a 2:3 portrait rectangle). Open
  `design/avatar-template.png` for a ready-made guide at exactly this size —
  it shows precisely where the arch falls, with a light grid for scale.
  Everything in the grey area outside the arch outline gets clipped away by
  the app automatically, so it's fine to leave blank, messy, or just ignore.
- **Fully opaque, no transparency needed.** Because clipping happens in CSS,
  your file can be a plain flat image — no alpha channel, no careful
  erasing around edges. This matters because classic Windows Paint doesn't
  handle transparency well at all; painting a plain rectangle sidesteps that
  limitation entirely.
- **Save as PNG**, named after the character's id — see the table below.
  Put finished files in `static/avatars/`.
- Keep the important part of the face/subject roughly centred and within
  the middle 70% of the canvas width — the pointed top corners get quite
  narrow, so anything you want clearly visible shouldn't hug the very top
  corners.

## Tools

- **Paint (classic) works fine** for this — you're painting a plain
  rectangle, not fighting with layers or transparency. `Image > Resize` (or
  `Resize/Skew`) to set the canvas to exactly 1000x1500px before you start.
- If you'd like layers, undo history, or easier colour blending and don't
  mind installing something, both **Paint.NET** and **GIMP** are free and a
  step up while staying easy to pick up. Neither is required — plain Paint
  is genuinely enough here.
- Whatever you use, work at the full 1000x1500px — the app scales down
  cleanly for the small circle-chip sizes, but scaling *up* from something
  smaller will look soft.

## Character ids (Trouble Brewing, current mini script)

Filename is always `<id>.png` in `static/avatars/`.

```
washerwoman   librarian   investigator   chef        empath
fortune-teller  undertaker   monk        ravenkeeper virgin
slayer        soldier     mayor          butler      drunk
recluse       saint       poisoner       spy         scarlet-woman
baron         imp
```

(This list lives in code at `src/lib/scripts/trouble-brewing.ts` — if the
script changes, that file is the source of truth, not this one.)

## Nothing breaks while the set is incomplete

A character with no file yet just shows a plain candle glyph in its arch
frame (`src/lib/components/Avatar.svelte` handles the fallback) — paint them
in whatever order you like, one at a time, and each appears in the app the
moment its file lands in `static/avatars/`. No restart needed in dev
(`npm run dev` hot-reloads static file changes); on the deployed build
you'd need to redeploy for a new file to ship.
