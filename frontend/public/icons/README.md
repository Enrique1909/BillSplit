# App / Home-Screen icons

These are the icons used when someone adds BillSplit to their Home Screen and for
the PWA manifest. **Don't hand-edit the individual PNGs** — they're all generated
from one source.

## Change the icon

1. Replace the source with your artwork (square):
   - **Vector (recommended):** edit [`icon-source.svg`](./icon-source.svg), or
   - **Bitmap:** drop in your own `icon-source.png` at **1024×1024 or larger**.
     A PNG source, if present, takes priority over the SVG.

   Keep the important part of the design within the **center ~80%** ("safe zone")
   — Android and iOS both round/mask the corners.

2. From the `frontend/` folder, run:
   ```
   npm run icons
   ```
   (macOS only — uses the built-in `qlmanage` + `sips`, no installs.)

3. Commit the regenerated PNGs and redeploy.

## What gets generated

| File | Size | Used for |
|------|------|----------|
| `apple-touch-icon.png` | 180 | iOS Home Screen (iOS ignores the manifest for this) |
| `icon-192.png` | 192 | manifest + favicon |
| `icon-512.png` | 512 | manifest (splash / install) |
| `icon-maskable.png` | 512 | Android adaptive (maskable) icon |

The master lives only as `icon-source.svg` (no oversized PNG ships to prod).

The browser-tab favicon is separate — it's [`../favicon.svg`](../favicon.svg);
edit it directly if you want the tab icon to match new artwork.

## References in the app

- `frontend/index.html` — `apple-touch-icon`, favicon, `apple-mobile-web-app-title`
- `frontend/public/manifest.webmanifest` — name, colors, `icons[]`
