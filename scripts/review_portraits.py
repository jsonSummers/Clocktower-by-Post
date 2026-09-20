#!/usr/bin/env python3
"""
review_portraits.py — regenerate every painted character portrait through
stained_glass.py and composite them into one labelled grid, so a new
painting or a stained-glass-effect tweak can be checked at a glance instead
of opening each avatar file one by one (or asking Claude to do it).

Run via scripts/review_portraits.sh, or directly:

    python3 scripts/review_portraits.py
    python3 scripts/review_portraits.py --strength strong --backlight-warmth 0.5
    python3 scripts/review_portraits.py --team demon --team minion
    python3 scripts/review_portraits.py --out design/portraits-review.png

Source paintings live in design/ (see SOURCE_OVERRIDES below for filenames
that don't match the character id — that's exactly the kind of mismatch
that once made the Washerwoman's portrait come out blank, so check this
dict any time a new painting's filename doesn't obviously match its id).
The character roster itself is parsed straight out of
src/lib/scripts/trouble-brewing.ts, so adding a new character there is
picked up automatically next run — nothing to update in this file for that.

A note on the save step: it writes to a temp file next to the destination
and only then replaces the destination (os.replace) rather than opening
the existing portraits-review.png directly in truncate mode. That's not
just defensive tidiness — review_portraits.ps1/.sh end by opening the
output in your default image viewer, and if that viewer (Photos, an
Explorer preview pane, etc.) still has the previous run's file open when
you run this again, a direct open(path, "w+b") over it is exactly the kind
of thing that raises OSError: [Errno 22] Invalid argument on Windows.
os.replace swaps the file at the filesystem level instead, which works
even while something else still has the old file open for reading.
"""
from __future__ import annotations  # keeps `Path | None` etc. working on Python < 3.10

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DESIGN_DIR = ROOT / "design"
SCRIPT_TS = ROOT / "src/lib/scripts/trouble-brewing.ts"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stained_glass import stained_glass  # noqa: E402

# Source filenames that don't match the character id/name in an obvious way.
# Update this when a new painting is saved under a name of its own choosing.
SOURCE_OVERRIDES = {
    "washerwoman": "washerwomen-full-avatar.png",
    "ravenkeeper": "ravenskeeper.png",  # source file is misspelled on disk
}

# Files in design/ that are never a portrait source. This script's own
# output filename is added to this set at runtime (see main()) so a re-run
# never risks fuzzy-matching a previous portraits-review.png as some
# character's source painting.
IGNORE_NAMES = {"avatar-template.png"}
IGNORE_SUFFIXES = {"~"}

TEAM_ORDER = ["townsfolk", "outsider", "minion", "demon", "traveller", "fabled"]

CARD_BG = (248, 241, 224)
CELL_W = 340
LABEL_H = 64
PAD = 18


def load_characters():
    """Pulls {id, name, team} for every character straight out of
    trouble-brewing.ts, in file order, so this stays correct as the roster
    grows without needing a matching edit here."""
    text = SCRIPT_TS.read_text(encoding="utf-8")
    # Only look inside the `characters: [...]` array — the Script object
    # itself also has its own top-level `id:`/`name:` fields (the script's
    # id/name, e.g. 'trouble-brewing'), which would otherwise be picked up
    # as a bogus 23rd character.
    marker = "characters:"
    idx = text.index(marker)
    text = text[idx:]
    chars = []
    # Scan for each `id: '...'` and pair it with the next `name:`/`team:` that
    # follows it — simpler and more robust than matching whole nested object
    # literals with a regex, and doesn't drift if the character shape changes.
    ids = [(m.start(), m.group(1)) for m in re.finditer(r"id:\s*'([^']+)'", text)]
    names = [(m.start(), m.group(1)) for m in re.finditer(r"name:\s*'([^']+)'", text)]
    teams = [(m.start(), m.group(1)) for m in re.finditer(r"team:\s*'([^']+)'", text)]

    def next_after(pos, items):
        for p2, v in items:
            if p2 > pos:
                return v
        return None

    for pos, cid in ids:
        name = next_after(pos, names)
        team = next_after(pos, teams)
        if name and team:
            chars.append({"id": cid, "name": name, "team": team})
    return chars


def find_source(char_id: str, name: str) -> Path | None:
    if char_id in SOURCE_OVERRIDES:
        p = DESIGN_DIR / SOURCE_OVERRIDES[char_id]
        return p if p.exists() else None

    candidates = [
        f"{char_id}.png",
        f"{char_id}-avatar.png",
        f"{char_id}-full-avatar.png",
        f"{char_id}s-avatar.png",
        f"{name.lower()}.png",
        f"{name.lower().replace(' ', '-')}.png",
        f"{name.lower().replace(' ', '')}.png",
    ]
    for c in candidates:
        p = DESIGN_DIR / c
        if p.exists():
            return p

    # Last resort: fuzzy match against every top-level png in design/ —
    # catches typos like "ravenskeeper" for "ravenkeeper" automatically.
    key = char_id.replace("-", "")
    best = None
    for p in DESIGN_DIR.glob("*.png"):
        if p.name in IGNORE_NAMES or p.suffix.lstrip(".") in IGNORE_SUFFIXES:
            continue
        stem = p.stem.lower().replace("-", "").replace("_", "")
        if key in stem or stem in key or (len(key) > 4 and key[:-1] in stem):
            best = p
            break
    return best


def load_font(size: int):
    for name in ("arial.ttf", "Arial.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def make_cell(char: dict, source: Path | None, effect_kwargs: dict) -> Image.Image:
    cell = Image.new("RGB", (CELL_W, CELL_W + LABEL_H), CARD_BG)
    draw = ImageDraw.Draw(cell)

    if source is not None:
        try:
            # Context-managed so the source file's handle is released as
            # soon as we're done with it, rather than lingering open for
            # the rest of the run — one fewer thing that could interact
            # badly with anything else touching design/ mid-run.
            with Image.open(source) as raw:
                avatar = stained_glass(raw, **effect_kwargs)
            avatar.thumbnail((CELL_W - 2 * PAD, CELL_W - 2 * PAD), Image.LANCZOS)
            x = (CELL_W - avatar.width) // 2
            y = (CELL_W - avatar.height) // 2 - 6
            cell.paste(avatar, (x, y), avatar)
        except Exception as e:  # noqa: BLE001 — keep the grid going, flag the failure in-cell
            draw.rectangle([PAD, PAD, CELL_W - PAD, CELL_W - PAD], outline=(200, 60, 60), width=2)
            msg = f"ERROR:\n{e}"
            draw.multiline_text((PAD + 8, PAD + 8), msg, fill=(160, 30, 30), font=load_font(14))
    else:
        draw.rectangle(
            [PAD, PAD, CELL_W - PAD, CELL_W - PAD], outline=(190, 180, 160), width=2
        )
        f = load_font(16)
        draw.text((CELL_W // 2, CELL_W // 2), "no portrait yet", fill=(150, 140, 120), font=f, anchor="mm")

    name_font = load_font(20)
    team_font = load_font(14)
    draw.text((CELL_W // 2, CELL_W + 8), char["name"], fill=(30, 26, 20), font=name_font, anchor="ma")
    draw.text(
        (CELL_W // 2, CELL_W + 34),
        f"{char['team']} · {char['id']}",
        fill=(110, 100, 85),
        font=team_font,
        anchor="ma",
    )
    return cell


def save_atomic(image: Image.Image, out_path: Path) -> None:
    """Write to a temp file in the same directory, then replace the
    destination — see the module docstring for why direct open()+save()
    over an existing, possibly-still-open file can fail on Windows."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(suffix=out_path.suffix or ".png", dir=str(out_path.parent))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        image.save(tmp_path)
        os.replace(tmp_path, out_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(DESIGN_DIR / "portraits-review.png"))
    ap.add_argument("--cols", type=int, default=5)
    ap.add_argument(
        "--team",
        action="append",
        choices=TEAM_ORDER,
        help="Limit to one or more teams (repeatable). Default: all teams.",
    )
    ap.add_argument("--strength", choices=["subtle", "medium", "strong"], default="medium")
    ap.add_argument("--light-strength", type=float, default=0.24)
    ap.add_argument("--backlight-warmth", type=float, default=0.5)
    ap.add_argument("--reflect-strength", type=float, default=0.12,
                     help="whole-window diagonal glare streaks -- turned down from 0.22 per "
                          "Mickey's \"reflection on the portraits turned down\"")
    ap.add_argument("--close-gap-iterations", type=int, default=0)
    ap.add_argument("--bridge-gap-px", type=float, default=8.0)
    ap.add_argument("--line-contrast-min", type=float, default=16.0)
    ap.add_argument("--line-max-halfwidth", type=float, default=11.0)
    ap.add_argument("--pane-sparkle-strength", type=float, default=0.35)
    ap.add_argument("--candle-glint-strength", type=float, default=0.24,
                     help="a small extra highlight low on the window's left side, tinted warm "
                          "gold like the candle overlay that sits just outside the frame there "
                          "-- Mickey's \"another very small reflection on the panels that "
                          "reflects the candle light\", nudged up once from 0.16 per \"make the "
                          "candle reflection a bit more\"; 0 disables")
    ap.add_argument("--bevel-strength", type=float, default=0.5)
    ap.add_argument("--texture-strength", type=float, default=0.15)
    ap.add_argument("--texture-warp-px", type=float, default=0.5)
    ap.add_argument("--dark-pane-floor", type=float, default=40.0,
                     help="min effective luminance for a pane fill, so dark fills don't fuse with the leading")
    ap.add_argument("--no-border", action="store_true")
    ap.add_argument("--only-painted", action="store_true", help="Skip characters with no source painting.")
    args = ap.parse_args()

    out_path = Path(args.out)
    # Never let this script's own output be picked up as a fuzzy-matched
    # "source" for some character on a later run (see IGNORE_NAMES above).
    IGNORE_NAMES.add(out_path.name)

    effect_kwargs = dict(
        strength=args.strength,
        light_strength=args.light_strength,
        backlight_warmth=args.backlight_warmth,
        reflect_strength=args.reflect_strength,
        close_gap_iterations=args.close_gap_iterations,
        bridge_gap_px=args.bridge_gap_px,
        line_contrast_min=args.line_contrast_min,
        line_max_halfwidth=args.line_max_halfwidth,
        pane_sparkle_strength=args.pane_sparkle_strength,
        bevel_strength=args.bevel_strength,
        texture_strength=args.texture_strength,
        texture_warp_px=args.texture_warp_px,
        dark_pane_floor=args.dark_pane_floor,
        border=not args.no_border,
        candle_glint_strength=args.candle_glint_strength,
    )

    characters = load_characters()
    if args.team:
        characters = [c for c in characters if c["team"] in args.team]
    characters.sort(key=lambda c: (TEAM_ORDER.index(c["team"]), c["name"]))

    rows = []
    found = 0
    for c in characters:
        src = find_source(c["id"], c["name"])
        if src:
            found += 1
        elif args.only_painted:
            continue
        rows.append((c, src))

    if not rows:
        print("No characters to render (check --team / --only-painted).")
        return

    cols = max(1, args.cols)
    n_rows = (len(rows) + cols - 1) // cols
    grid = Image.new(
        "RGB",
        (cols * CELL_W, n_rows * (CELL_W + LABEL_H)),
        CARD_BG,
    )
    for i, (char, src) in enumerate(rows):
        cell = make_cell(char, src, effect_kwargs)
        gx = (i % cols) * CELL_W
        gy = (i // cols) * (CELL_W + LABEL_H)
        grid.paste(cell, (gx, gy))

    save_atomic(grid, out_path)
    print(f"saved {out_path} — {found}/{len(rows)} portraits found, {len(rows) - found} pending")
    for char, src in rows:
        if not src:
            print(f"  no source found for: {char['id']} ({char['name']}) — add SOURCE_OVERRIDES entry if its filename doesn't match")


if __name__ == "__main__":
    main()
