# Textures

`src/app.css` picks up textures from this folder automatically — nothing
breaks if a file below is missing, it just falls back to a flat colour/
gradient in the same tone.

| Filename            | Used for                          | Look for                                   |
|---------------------|------------------------------------|---------------------------------------------|
| `limestone.jpg`     | page background                    | pale sandstone / limestone wall, seamless   |
| `parchment.jpg`     | card panels                        | vellum / aged paper, seamless, light        |
| `oak.jpg`           | (reserved — header/footer wood)    | worn oak plank, seamless                    |
| `redstone.jpg`      | (reserved — header band / top rule)| warm red sandstone, seamless                |

## Generate them (recommended)

You don't need to source or hand-paint any of these. `scripts/make_textures.py`
generates all four, procedurally, straight from the same colour tokens
`src/app.css` already defines (`--bg`, `--surface`, `--redstone`, `--lead`,
etc.) — so they match the theme by construction instead of by luck, and
there's no licence to check.

```
python3 scripts/make_textures.py static/textures
```

That overwrites all four `.jpg` files in place. Each texture is its own
function in the script (`limestone()`, `redstone()`, `parchment()`, `oak()`)
with a `seed` argument — rerun with a different seed for a different roll
of the same look, or open the function and nudge the palette/contrast
constants at the top of the file if you want a different mood. The tiling
itself (so `background-repeat: repeat` shows no seam) comes from a small
value-noise-with-wrapped-padding trick that's `numpy`+`Pillow` only — no
extra libraries to install beyond what the script already imports.

## Alternative: free photo textures

If you'd rather have a more photographic look for one of these, real
seamless photo textures work too — drop a same-named `.jpg` into this
folder to override the generated one. All of the following are free for
this kind of personal/non-commercial project — check each site's specific
licence for anything you'd distribute publicly.

- **ambientCG** (ambientcg.com) — CC0 (no attribution needed), high-quality,
  and every texture has a pre-made seamless tile. Search "Limestone",
  "PavingStones", "Marble", "Plaster" or "Wood".
- **Poly Haven** (polyhaven.com/textures) — also CC0, same idea, gorgeous
  stone/plaster/wood sets.
- **3dtextures.me** — CC0, smaller/simpler images, very easy to skim.
- **CGBookcase** (cgbookcase.com) — free tier, seamless PBR textures.
- **OpenGameArt.org** — more game-asset flavoured; good for parchment/paper
  and painterly stone if the photographic ones feel too realistic next to
  hand-painted avatars.

### Sizing tips

- Pick the "seamless"/"tileable" version where a site offers a choice —
  that's what lets `background-repeat: repeat` tile it without visible seams.
- 512–1024px square is plenty; anything bigger just costs load time on a
  phone at a party with patchy wifi.
- Save as `.jpg` (photos compress far smaller than `.png` for this) unless
  you need transparency.
