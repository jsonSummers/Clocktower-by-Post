# Character avatars

One PNG per character, named by id, e.g. `imp.png`, `washerwoman.png`,
`fortune-teller.png` — see `src/lib/scripts/trouble-brewing.ts` for the exact
ids (they match the `id:` field of each character). A character with no file
here just shows a plain candle glyph in its gothic-arch frame — nothing
breaks while you're still painting the set.

**Full painting guide (canvas size, format, tool recommendations) is in
`docs/avatars.md`.** Short version: paint a plain rectangular image at
**1000 x 1500px**, no transparency needed — the app clips every avatar into
the same pointed-arch window shape in CSS, so your file just needs to fully
cover that canvas. `design/avatar-template.png` is a ready-to-open guide
showing exactly where the arch falls.
