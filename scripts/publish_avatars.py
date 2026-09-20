#!/usr/bin/env python3
"""
publish_avatars.py -- runs every character with a painted source through
stained_glass.py and writes the result straight to static/avatars/<id>.png,
the actual files the running app serves (Avatar.svelte's `src`).

Until now that step was manual and easy to fall behind on -- reusing
review_portraits.py's own find_source()/load_characters() surfaced four
characters with a painting in design/ but no static/avatars/ file at all
(investigator, virgin, slayer, soldier -- Mickey specifically asked why
Soldier wasn't showing up; this is why). Also the one place that actually
applies review_portraits.py's tuned stained-glass settings (reflection
turned down, the new candle-tinted glint) to the files the app serves,
rather than only to the design/portraits-review.png preview grid.

Uses the exact same effect settings as review_portraits.py's own CLI
defaults, so the preview grid and the shipped avatars never drift apart --
update BOTH files together if either one's defaults change.

Usage:
    python3 scripts/publish_avatars.py            # every character with art
    python3 scripts/publish_avatars.py soldier virgin slayer investigator
"""
import sys
import tempfile
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from review_portraits import load_characters, find_source  # noqa: E402
from stained_glass import stained_glass  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
AVATARS_DIR = ROOT / "static" / "avatars"

# Kept in sync with review_portraits.py's own argparse defaults by hand --
# see that file's main() if these two ever need to be reconciled.
EFFECT_KWARGS = dict(
    strength="medium",
    light_strength=0.24,
    backlight_warmth=0.5,
    reflect_strength=0.12,
    pane_sparkle_strength=0.35,
    candle_glint_strength=0.24,
    bevel_strength=0.5,
    texture_strength=0.15,
    texture_warp_px=0.5,
    dark_pane_floor=40.0,
    border=True,
)


def save_atomic(image: Image.Image, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(suffix=".png", dir=str(out_path.parent))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        image.save(tmp_path)
        os.replace(tmp_path, out_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def main():
    only = set(sys.argv[1:]) or None
    chars = load_characters()
    published, skipped = [], []
    for c in chars:
        if only and c["id"] not in only:
            continue
        source = find_source(c["id"], c["name"])
        if source is None:
            skipped.append(c["id"])
            continue
        with Image.open(source) as raw:
            avatar = stained_glass(raw, **EFFECT_KWARGS)
        out_path = AVATARS_DIR / f"{c['id']}.png"
        save_atomic(avatar, out_path)
        published.append(c["id"])
        print(f"published {out_path} ({avatar.size[0]}x{avatar.size[1]})")

    print(f"\n{len(published)} published, {len(skipped)} skipped (no source painting yet): "
          f"{', '.join(skipped) if skipped else '(none)'}")


if __name__ == "__main__":
    main()
