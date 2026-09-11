#!/usr/bin/env bash
# review_portraits.sh — regenerate every painted character portrait and
# composite them into one labelled grid at design/portraits-review.png, so
# a new painting or an effect tweak can be checked without asking Claude to
# re-run it each time. Requires python3 with pillow/numpy/scipy installed
# (the same ones scripts/stained_glass.py already needs).
#
# Usage:
#   ./scripts/review_portraits.sh
#   ./scripts/review_portraits.sh --strength strong --backlight-warmth 0.5
#   ./scripts/review_portraits.sh --team demon --team minion
#
# Any arguments are passed straight through to review_portraits.py — see
# `python3 scripts/review_portraits.py --help` for the full list.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
"$PY" scripts/review_portraits.py "$@"

OUT="design/portraits-review.png"
if [ -f "$OUT" ]; then
	if command -v explorer.exe >/dev/null 2>&1; then
		explorer.exe "$(cygpath -w "$OUT" 2>/dev/null || echo "$OUT")" >/dev/null 2>&1 || true
	elif command -v open >/dev/null 2>&1; then
		open "$OUT" || true
	elif command -v xdg-open >/dev/null 2>&1; then
		xdg-open "$OUT" || true
	fi
fi
