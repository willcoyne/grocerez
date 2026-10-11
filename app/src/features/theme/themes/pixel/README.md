# Pixel theme (`id: "pixel"`)

A cozy, Stardew-Valley-ish farmhouse drawn as pixel art in Three.js. It uses original colours, glyphs and textures,
and copies no game assets.

## The look
- **Render**: low-res render upscaled with nearest filtering (`effects.pixelate.pixelSize = 3` CSS px), posterized to
  16 levels per channel, a very light ordered dither (0.08), a soft 1px dark-brown sprite outline (`#3B2314`, 0.35)
  and a soft vignette. `toneMapping: "none"` so palette colours come out as authored. These values were tuned in a
  headless preview of the real `PantryExterior` through the core's `<ThemeEffects/>`: 7 levels turned everything a
  muddy orange, a 0.35 dither read as grime, and pixel size 4 broke up the "Grocer" letters and the door gap.
- **Shading**: `materialStyle: "flat"` (Lambert, faceted, no specular). Golden late-afternoon key light (`#FFD7A0`), lavender
  sky fill (`#C3B2EC`) so shadows go cool against warm light, hemisphere bounce from the brown floor, and drop shadows on.
- **Palette** (`palette.ts`): golden oak `#C9853F`, deep brown outline wood `#6E3F22`, honey `#EBB767`, cream-peach
  wallpaper `#F3D9AE`, floor planks `#B66D35` / `#A15D2C`, grass green `#5FA83B`, terracotta pot `#C4613A`,
  parchment `#FFF1CF` with brown ink `#4A2B1A`, tomato-red allergen `#E5372A`, sunny selection `#FFE15A`.
- **Allergen glow**: `blink`, a two-frame on/off blink at 1 Hz (below the 3-flashes-per-second limit). It should be
  paired with the text label, as in every theme, because colour alone is not enough.
- **UI** (`PIXEL_UI`): a farming-game menu. Parchment panels (`#FBE6B8`) in a 3px dark wooden frame (`#6E3F22`),
  oak button rings, square corners (`radius: 0`), `pixelBorders: true`. Text pairs meet WCAG AA (checked in the test).
  `fontFamily` is `null` because no pixel font is installed for React Native text (only Manrope, Bricolage
  Grotesque and Material Symbols). The 3D scene uses the pixel font below.

## Pixel textures (`textures.ts`)
`pixelTextures` is an optional hook for the theme core's `themedTexture`. Each entry is a factory that returns a fresh
`DataTexture` (nearest filter, no mipmaps, `RepeatWrapping`, seamless):

| factory (alias) | art | size |
|---|---|---|
| `woodPlanks` (`wood`) | golden oak planks with knots, light top edge, shadowed bottom edge, staggered joints | 64x64 |
| `floorBoards` (`floor`) | floor planks alternating `floor`/`floorAlt`, staggered joints with nail heads | 64x64 |
| `wallpaper` (`wall`) | cream-peach wallpaper with soft stripes and tiny four-petal flowers | 32x32 |
| `crateBoards` (`shelf`) | light crate/shelf boards with a nail at each end | 32x32 |

Options: `{ mode?: "color" | "luma", palette?: Partial<ThemePalette>, seed?, texelsPerUnit? }`.
- `"color"` (the default) gives an sRGB, palette-coloured texture. Use it with material colour white.
- `"luma"` gives a grey multiplier (base tone about 0.88, highlight 1.0, linear colour space). Use it for tinted or
  vertex-coloured materials such as the exterior's shared wood material.

Colours come from a 5-tone hue-shifted ramp per base colour (`rampOf`): outline, shadow, base, light, highlight.
With `texelsPerUnit: 32`, a tile covers `width / 32` world units. For a surface `S` units long, set
`repeat = S * 32 / width`; `texture.userData.tileWorldSize` has the tile size. The factories don't cache, so the caller
owns and disposes the textures. `pixelTextureImages` exposes the raw RGBA grids, which are handy for tests.

## Pixel font (`font.typeface.json`, from `buildFont.mjs`)
GrocerPixel is an original 5x7 bitmap font with 2 descender rows and proportional widths. It covers ASCII 32-126, `°`,
and `• · … – — ‘ ’ “ ” ×`.
- `node buildFont.mjs` regenerates the JSON. `--check` verifies it is current (the jest test runs this), and
  `--preview "text"` prints ASCII art.
- Metrics: 1 pixel = 100 units, `resolution: 700`, so the cap height is exactly 1 em. That matches helvetiker's
  ~1.01 em, so text laid out for helvetiker stays roughly the same size. Advance = (width + 1) * 100. Line height is
  10 px (1.43 em).
- Lit pixels are merged into rectangles: horizontal runs, then identical runs stacked vertically (or column-first if
  that gives fewer). Each rectangle is a clockwise subpath, so three builds one solid shape per rectangle, with no
  holes or curves. That averages about 54 triangles per extruded glyph ("Grocer" = 288).
- Use it with `bevelEnabled: false` (`curveSegments` doesn't matter). A bevel puts seams between the merged
  rectangles, and crisp blocks look more pixel-art anyway.

## Files
`index.ts` (default export `SceneTheme`, plus `pixelTextures`, `PIXEL_PALETTE`, `PIXEL_UI`), `palette.ts`,
`textures.ts`, `buildFont.mjs`, `font.typeface.json`, and `__tests__/pixel.test.ts`.

## Integration notes
- The 3D text should use `bevelEnabled: false` with this font (see above).
- The wallpaper and floor are baked colour (`userData.baked`). Don't also multiply the wall by the exterior's
  `PALETTE.wall` vertex-colour gradient: that applies the colour twice and turns the wall salmon. Use white (or a
  grey-to-white gradient) vertex colours for the pixel wall.
- `woodPlanks` has no butt joints on purpose (joints read as bricks on narrow uprights). The floor keeps its
  staggered joints.
