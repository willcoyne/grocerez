# Neon theme ("synthwave night")

The Pantry at night: a very dark navy room under low violet light, dark rough furniture, and magenta and cyan neon
along edges and shelf lips. The "Grocer" letters and the EZ sign are lit like bent-glass tubes, over a magenta grid
floor with scanline grain, bloom and a little fog. Allergens pulse in hot red neon.

| Token | Value | Why |
|---|---|---|
| `materialStyle` | `standard` | dark, rough PBR; the glow comes from emissive plus bloom |
| `textureStyle` | `grid` | the core draws `neonGridImage` with `floor` as the base and `floorAlt` (magenta) as the lines, plus an emissive mask |
| `background` / `wall` | `#0A0A1E` / `#191544` | night room |
| `lighting` | violet key 1.5, cyan fill 0.55, hemi 0.45, ambient 0.1 | low light that still shows the furniture |
| `effects` | bloom 1.1 @ 0.55, scanline grain 0.14, vignette 0.35 | glow, CRT feel |
| `palette.woodLight` | magenta `#FF3FD8` | "Grocer" tube letters |
| `palette.trim` / `knob` | cyan `#21E6FF` | baseboard, crown and shelf-lip strips, knobs |
| `palette.paper` / `ink` | dark `#1C1F46` / light `#EAF7FF` | dark tags with light text (above 12:1) |
| `allergenGlow` | `pulse`, 1.2 s, `#FF2A4D` | strong but about 0.8 Hz, far below 3 flashes/s; a different hue from the magenta letters |
| `font` | `retro` | round-capped monoline glyphs read as neon tubes (the core reuses diner's `font.typeface.json`) |
| `ui` | dark panel, 2 px cyan border, radius 14 | |

## Files
- `index.ts`: default export plus texture re-exports.
- `textures.ts`: `neonGridImage()` (the floor), `neonTubeImage()` (a tube-profile strip, tiling along U, for edges),
  and `neonWallImage()` (dark panels with faint violet seams). Pure, tileable RGBA.

## Integration notes
- The roles have no per-theme emissive, so the integration needs to add it for this theme. Give the letters
  (`woodLight`), the edge strips (`trim`), the knobs, the EZ sign text, the shelf-lip strip and the fridge display an
  `emissive` equal to their palette colour, intensity about 1.6 to 2.6, as in the preview harness's `glow()`. Keep
  label faces non-emissive so the light `ink` text stays readable.
- "Dark translucent panels": the contract only takes a hex `ui.panel` (`#120F2E`). Overlays that support alpha should
  draw it at about 88% opacity.
