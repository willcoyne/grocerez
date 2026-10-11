/**
 * Glyph metrics straight from the bundled typeface JSON (no three.js import, so it is cheap to unit-test).
 * Matches three's FontLoader layout: advance = glyph.ha * size / resolution; unknown glyphs fall back to "?".
 */
import fontJson from "../fonts/helvetiker_bold.typeface.json";

type Glyph = { ha: number };
type FontJson = { resolution: number; glyphs: Record<string, Glyph | undefined> };

const FONT = fontJson as unknown as FontJson;

/** True when the bundled font has an outline for this character. */
export function hasGlyph(ch: string): boolean {
  return !!FONT.glyphs[ch];
}

/** Advance width of a single line of text at `size` (world units per em). */
export function measureText(text: string, size: number): number {
  const scale = size / FONT.resolution;
  let w = 0;
  for (const ch of Array.from(text)) {
    const g = FONT.glyphs[ch] ?? FONT.glyphs["?"];
    if (g) w += g.ha * scale;
  }
  return w;
}

const REPLACEMENTS: [RegExp, string][] = [
  [/[‘’‚‛`´]/g, "'"],
  [/[“”„‟]/g, '"'],
  [/[‐‑‒—―]/g, "-"],
  [/\s+/g, " "],
];

/**
 * Make label text renderable with the bundled font: strip accents ("crème" → "creme"), straighten quotes,
 * collapse whitespace/newlines, and drop characters the font has no glyph for (instead of rendering "?").
 */
export function sanitizeLabelText(text: string): string {
  let s = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [re, to] of REPLACEMENTS) s = s.replace(re, to);
  return Array.from(s)
    .filter((ch) => ch === " " || hasGlyph(ch))
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
}
