# Sketch theme ("hand-drawn ink on paper")

The Pantry as the team's pen drawings (`plan/frontend/drawing-ideas/*.jpg`): off-white paper, paper-white surfaces
with black felt-tip outlines, shadows drawn as hatching, paper grain, hand-lettered 3D text, and a notebook-style UI.
Colour is used sparingly: a red marker for allergens, a yellow highlighter for search, and a blue ballpoint accent.

| Token | Value | Why |
|---|---|---|
| `materialStyle` | `ink` | paper fill plus pen hatching that gets denser in shadow (core `materials.ts`) |
| `textureStyle` | `hatch` | hatched wood and floor, paper wall |
| `effects.outline` | ink `#1E1D1A`, 1.75 px, strength 1 | the felt-tip contour lines |
| `effects.grain` | `paper`, 0.22 | paper tooth over the whole frame |
| `palette.woodLight` | ink | the "Grocer" letters are solid marker, like the drawing |
| `palette.knob` | ink | the drawing's knobs are inked blobs |
| `allergenGlow` | `outline`, 1.8 s | a red marker scribble around the item, never flashing |
| `toneMapping` | `neutral` | keeps paper white (ACES greys it) |
| `ui` | white panels, 2 px ink border, radius 6 | notebook page |
| `font` | `hand` | `font.typeface.json`, GrocerEZ Hand |

## Files
- `index.ts`: default export `SceneTheme`, plus re-exports of the texture generators.
- `textures.ts`: `paperImage()` and `hatchImage({ level: 1 | 2 | 3 })`. Pure, tileable RGBA generators (the core's
  `textures.ts` uses `paperImage`).
- `textureImage.ts`: the shared `ThemeImage` type, PRNG, tileable noise and `imageToDataTexture` (also used by the neon
  and diner themes).
- `font.typeface.json`: **generated, don't hand-edit.** Rebuild with
  `node src/features/theme/themes/sketch/buildFont.mjs [--preview out.svg]` (run from `app/`, about 20 s, deterministic).
- `buildFont.mjs`: hand style. It slants about 5°, gives each glyph a tiny turn and baseline nudge, and draws with a
  wobbling, pressure-varying pen whose loops overshoot their start (`handJitter`).
- `strokeGlyphs.mjs`: single-stroke skeletons for ASCII 32-126 plus `°`, written once against a style (ellipse bowls
  here, squircle bowls for diner).
- `strokeFont.mjs`: the build engine shared with diner. A round pen goes over the skeletons via a signed distance
  field and marching squares, giving one clean outline per blob with real holes. Solids are clockwise and holes
  counter-clockwise, because three r186's `ShapePath.toShapes` drops overlapping or mis-wound contours, so separate
  per-stroke polygons would lose pieces.
- `testkit.ts`: Jest helpers shared by all three themes, covering token validity and contrast, plus a typeface round
  trip through three's `Font` → `toShapes` → triangulation that asserts no contour is dropped.

## Font metrics
Resolution 1000, ink cap height about 1000 (same as helvetiker, so `size` ≈ cap height), x-height about 720,
descender about −300. Every label in the tests sets **narrower** than helvetiker bold (about 0.82×), so existing
layouts fit.

## Integration notes
- `ui.fontFamily` is `null` because no handwriting React Native font is registered in the app, and an unknown family
  logs an error on iOS. Once the core bundles one (for example Caveat or Patrick Hand via `@expo-google-fonts`),
  register it as `"hand"` and set `ui.fontFamily: "hand"`.
- Small text backs (labels, name tags) should pass `hatch: false`, as the core's role table already does for `ink`
  and `paper`.
