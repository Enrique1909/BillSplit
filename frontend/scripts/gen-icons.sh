#!/usr/bin/env bash
#
# Regenerate every Home-Screen / PWA icon from a single source image.
#
# ── To change the app icon ────────────────────────────────────────────────────
#   1. Replace the source:
#        • edit  public/icons/icon-source.svg   (vector — recommended), OR
#        • drop in your own square  public/icons/icon-source.png  (>= 1024px).
#      A PNG source, if present, wins over the SVG.
#   2. Run:  npm run icons
#   3. Commit the regenerated PNGs and redeploy.
#
# Requires macOS only — uses the built-in `qlmanage` (SVG → PNG) and `sips`
# (resize). No npm packages to install.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

ICONS="public/icons"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1) Produce a 1024px master PNG from whatever source is present.
if [ -f "$ICONS/icon-source.png" ]; then
  echo "Source: $ICONS/icon-source.png"
  cp "$ICONS/icon-source.png" "$TMP/master.png"
elif [ -f "$ICONS/icon-source.svg" ]; then
  echo "Source: $ICONS/icon-source.svg (rasterizing with qlmanage)"
  qlmanage -t -s 1024 -o "$TMP" "$ICONS/icon-source.svg" >/dev/null 2>&1
  mv "$TMP/icon-source.svg.png" "$TMP/master.png"
else
  echo "ERROR: no source found (expected $ICONS/icon-source.svg or icon-source.png)" >&2
  exit 1
fi

# 2) Resize to every size the manifest + iOS need. The source is a full-bleed
#    opaque square, so there's no alpha to flatten for the iOS icon.
gen() { sips -z "$1" "$1" "$TMP/master.png" --out "$2" >/dev/null; }
gen 512  "$ICONS/icon-512.png"
gen 512  "$ICONS/icon-maskable.png"   # glyph sits inside the maskable safe zone
gen 192  "$ICONS/icon-192.png"
gen 180  "$ICONS/apple-touch-icon.png"

echo "✓ Regenerated: icon-512, icon-maskable, icon-192, apple-touch-icon"
echo "  Next: commit the PNGs and redeploy. (favicon.svg is separate — edit it directly.)"
