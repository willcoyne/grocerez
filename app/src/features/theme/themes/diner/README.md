# Diner theme ("1950s retro diner")

A roadside diner: mint cabinetry with cherry-red trim, cream walls, chrome knobs and steel, a black-and-white
checkerboard floor, glossy cartoon shading (toon, 3 bands) under warm bright light, and a slight vignette.

| Token | Value | Why |
|---|---|---|
| `materialStyle` / `toonSteps` | `toon` / 3 | glossy cartoon bands |
| `textureStyle` | `checker` | the core draws `checkerImage` with `floor` (white) and `floorAlt` (black) |
| `palette.wood` / `woodDark` | mint `#A8E6CF` / cherry `#D7263D` | body, plus uprights, crown, plinth and louvres |
| `palette.woodLight` | `#E23B4F` | "Grocer" in bright cherry sign letters. Chrome letters disappeared against cream in the toon render, so chrome stays on trim, knobs and steel. |
| `palette.wall` | cream `#FFF3D6` | |
| `palette.allergen` | `#FF5A1F` | hot orange-red, so it isn't mistaken for the cherry trim |
| `palette.highlight` | mustard `#FFC93C` | |
| `effects` | vignette 0.22, bloom 0.25 @ 0.9 (only chrome highlights), no grain | |
| `toneMapping` | `neutral` | clean, saturated toon colours |
| `ui` | cream `#FFF8E7` panel, 3 px cherry border, radius 22 | |
| `font` | `retro` | `font.typeface.json`, GrocerEZ Retro Bold |

## Files
- `index.ts`: default export plus texture re-exports.
- `textures.ts`: `checkerImage()` (linoleum with grout, mottling and wax sheen) and `formicaImage()` (mint 1950s
  boomerang laminate with gold flecks, for shelf tops). Pure, tileable RGBA.
- `font.typeface.json`: **generated.** Rebuild with
  `node src/features/theme/themes/diner/buildFont.mjs [--preview out.svg]` (run from `app/`).
- `buildFont.mjs`: retro style. It uses the same skeleton table and engine as the sketch font
  (`../sketch/strokeGlyphs.mjs`, `../sketch/strokeFont.mjs`) but with squircle bowls (superellipse n = 3.6), a tall
  x-height, wide sign proportions, slab `I` / `J` / `1`, and a fat round pen (16% of cap height) with no jitter or slant.
  Labels set about 0.96× helvetiker bold's width.

## Integration notes
- If the shelf interior back panel takes `woodDark`, the inside turns solid red. Use `wood` (mint) or `formicaImage`.
- `ui.fontFamily` is `null` until the app registers a rounded display React Native font as `"retro"`.
