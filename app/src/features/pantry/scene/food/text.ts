/**
 * 3D text via TextGeometry + a bundled typeface (works on web and on native through expo-gl; no DOM canvas).
 * Font: the theme's typeface (theme core getThemeFont; cozy = helvetiker bold from three.js examples, MgOpen licence,
 * see ../fonts/LICENSE). Every helper takes an optional theme (default: the active one).
 * Other scene builders may reuse `getTextGeometry` / `getFoodFont`.
 */
import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { drawableTextFor, fontHasGlyph, getThemeFont, textAdvance } from "../../../theme/fonts";
import { getActiveTheme } from "../../../theme/store";
import type { SceneTheme } from "../../../theme/types";
import { measureText } from "./fontMetrics";

export function getFoodFont(theme: SceneTheme = getActiveTheme()): Font {
  return getThemeFont(theme);
}

/** Text the font can draw: a middle dot falls back to a hyphen, other missing glyphs are dropped (never "?"). */
export function drawableFoodText(text: string, font: Font): string {
  const t = fontHasGlyph(font, "·") ? text : text.replace(/·/g, "-");
  return drawableTextFor(font, t);
}

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Centred (x and cap-height) flat text geometry, cached by theme+text+size. Shared; never dispose.
 */
export function getTextGeometry(text: string, size: number, depth = size * 0.08, theme: SceneTheme = getActiveTheme()): THREE.BufferGeometry {
  const key = `${theme.id}|${size}|${depth}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const font = getFoodFont(theme);
  const g = new TextGeometry(drawableFoodText(text, font), { font, size, depth, curveSegments: 3, bevelEnabled: false });
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  if (Number.isFinite(bb.min.x)) g.translate(-(bb.min.x + bb.max.x) / 2, -size * 0.36, -depth / 2);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  cache.set(key, g);
  return g;
}

/** Width of a cached text geometry. */
export function textWidth(g: THREE.BufferGeometry): number {
  const bb = g.boundingBox;
  return bb && Number.isFinite(bb.min.x) ? bb.max.x - bb.min.x : 0;
}

/** One positioned run of flat text (left-aligned, `y` = baseline) in a shared 2D plane. */
export type FlatTextRun = { text: string; x: number; y: number; size: number };

/**
 * Many runs merged into ONE flat (zero-depth) text geometry: one draw call per colour for a whole label.
 * Uses the font's glyph shapes (same outlines TextGeometry extrudes) without the extrusion, so half the triangles.
 * Layouts are measured with helvetiker metrics (fontMetrics.ts); a theme font that sets a run wider is squeezed
 * horizontally to the measured width so wrapped labels never overflow. The caller owns the result (dispose when
 * done). Returns null for no visible glyphs.
 */
export function buildFlatTextGeometry(runs: FlatTextRun[], curveSegments = 2, theme: SceneTheme = getActiveTheme()): THREE.BufferGeometry | null {
  const font = getFoodFont(theme);
  const helvetiker = theme.font === "helvetiker";
  const parts: THREE.BufferGeometry[] = [];
  for (const r of runs) {
    if (!r.text.trim()) continue;
    const text = helvetiker ? r.text : drawableFoodText(r.text, font);
    if (!text.trim()) continue;
    const g = new THREE.ShapeGeometry(font.generateShapes(text, r.size), curveSegments);
    if (!helvetiker) {
      const want = measureText(r.text, r.size);
      const have = textAdvance(font, text, r.size);
      if (have > want && have > 0) g.scale(want / have, 1, 1);
    }
    g.translate(r.x, r.y, 0);
    parts.push(g);
  }
  if (!parts.length) return null;
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (parts.length > 1) for (const p of parts) p.dispose();
  if (!merged) return null;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
