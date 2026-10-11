/**
 * 3D text font per theme (`getThemeFont`) for TextGeometry / ShapeGeometry. Typeface JSON modules are bundled
 * statically (Metro can't require dynamic paths): helvetiker bold for theme.font === "helvetiker", otherwise the
 * theme's own ./themes/<id>/font.typeface.json, else another theme's font with the same `font` key (neon "retro" ->
 * diner's retro font), else helvetiker.
 * Owner: theme core.
 */
import { Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";

import helvetikerJson from "../pantry/scene/fonts/helvetiker_bold.typeface.json";
import dinerFontJson from "./themes/diner/font.typeface.json";
import pixelFontJson from "./themes/pixel/font.typeface.json";
import sketchFontJson from "./themes/sketch/font.typeface.json";
import type { SceneTheme, ThemeId } from "./types";

/** Themes that ship ./themes/<id>/font.typeface.json (add a static import when another theme ships one). */
const THEME_FONT_JSON: Partial<Record<ThemeId, unknown>> = {
  pixel: pixelFontJson,
  sketch: sketchFontJson,
  diner: dinerFontJson,
};

/** Font key -> the theme folder whose font JSON draws that style. */
const FONT_KEY_SOURCE: Record<Exclude<SceneTheme["font"], "helvetiker">, ThemeId> = {
  pixel: "pixel",
  hand: "sketch",
  retro: "diner",
};

const fonts = new Map<string, Font>();

function fontFrom(key: string, json: unknown): Font {
  let f = fonts.get(key);
  if (!f) {
    f = new Font(json as FontData);
    fonts.set(key, f);
  }
  return f;
}

export function getHelvetikerFont(): Font {
  return fontFrom("helvetiker", helvetikerJson);
}

/** The typeface for 3D text in `theme` (cached; shared, never dispose). */
export function getThemeFont(theme: SceneTheme): Font {
  if (theme.font === "helvetiker") return getHelvetikerFont();
  const own = THEME_FONT_JSON[theme.id];
  if (own) return fontFrom(theme.id, own);
  const source = FONT_KEY_SOURCE[theme.font];
  const shared = source ? THEME_FONT_JSON[source] : undefined;
  return shared ? fontFrom(source, shared) : getHelvetikerFont();
}

/** Does the font have a glyph for this character (space always counts)? */
export function fontHasGlyph(font: Font, ch: string): boolean {
  if (ch === " ") return true;
  const glyphs = (font.data as unknown as { glyphs: Record<string, unknown> }).glyphs;
  return !!glyphs[ch];
}

/**
 * Text the font can draw: tries the character, its accent-stripped form, then upper / lower case (pixel and retro
 * fonts may only have capitals); anything else is dropped so TextGeometry never logs missing glyphs.
 */
export function drawableTextFor(font: Font, text: string): string {
  let out = "";
  for (const ch of text) {
    const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const options = [ch, plain, ch.toUpperCase(), plain.toUpperCase(), ch.toLowerCase()];
    const hit = options.find((c) => c.length > 0 && fontHasGlyph(font, c));
    if (hit) out += hit;
  }
  return out;
}

/** Horizontal advance of `text` in world units at `size` (unknown glyphs count as 0.3 em). */
export function textAdvance(font: Font, text: string, size: number): number {
  const data = font.data as unknown as { resolution: number; glyphs: Record<string, { ha: number }> };
  let w = 0;
  for (const ch of text) w += data.glyphs[ch]?.ha ?? data.resolution * 0.3;
  return (w / data.resolution) * size;
}
