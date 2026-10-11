/**
 * 3D text via TextGeometry + a bundled typeface (works on web and on native through expo-gl; no DOM canvas).
 * Font: helvetiker bold from three.js examples (MgOpen licence, see ./fonts/LICENSE).
 * Other scene builders may reuse `getTextGeometry` / `getFoodFont`.
 */
import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import fontJson from "../fonts/helvetiker_bold.typeface.json";

let font: Font | null = null;
export function getFoodFont(): Font {
  if (!font) font = new Font(fontJson as unknown as FontData);
  return font;
}

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Centred (x and cap-height) flat text geometry, cached by text+size. Shared; never dispose.
 * Glyphs missing from the font are dropped by three.
 */
export function getTextGeometry(text: string, size: number, depth = size * 0.08): THREE.BufferGeometry {
  const key = `${size}|${depth}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = new TextGeometry(text, { font: getFoodFont(), size, depth, curveSegments: 3, bevelEnabled: false });
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, -size * 0.36, -depth / 2);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  cache.set(key, g);
  return g;
}

/** Width of a cached text geometry. */
export function textWidth(g: THREE.BufferGeometry): number {
  const bb = g.boundingBox;
  return bb ? bb.max.x - bb.min.x : 0;
}

/** One positioned run of flat text (left-aligned, `y` = baseline) in a shared 2D plane. */
export type FlatTextRun = { text: string; x: number; y: number; size: number };

/**
 * Many runs merged into ONE flat (zero-depth) text geometry: one draw call per colour for a whole label.
 * Uses the font's glyph shapes (same outlines TextGeometry extrudes) without the extrusion, so half the triangles.
 * The caller owns the result (dispose when done). Returns null for no visible glyphs.
 */
export function buildFlatTextGeometry(runs: FlatTextRun[], curveSegments = 2): THREE.BufferGeometry | null {
  const font = getFoodFont();
  const parts: THREE.BufferGeometry[] = [];
  for (const r of runs) {
    if (!r.text.trim()) continue;
    const g = new THREE.ShapeGeometry(font.generateShapes(r.text, r.size), curveSegments);
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
