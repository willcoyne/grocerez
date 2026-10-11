// Bundled typeface for 3D text (works on native: no DOM canvas needed).
// helvetiker_bold.typeface.json comes from three.js examples/fonts (Helvetiker, Copyright (c) Magenta ltd, 2004,
// MgOpen licence: free to use, modify and redistribute). It is not shipped in the `three` npm package, so it is
// vendored here.
import type { BufferGeometry } from "three";
import { Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import fontJson from "../fonts/helvetiker_bold.typeface.json";

let font: Font | null = null;

export function getFont(): Font {
  if (!font) font = new Font(fontJson as unknown as FontData);
  return font;
}

/** Replace characters the typeface can't draw (emoji, accents...) so TextGeometry never logs/throws. */
export function drawableText(text: string): string {
  const glyphs = (getFont().data as unknown as { glyphs: Record<string, unknown> }).glyphs;
  let out = "";
  for (const ch of text) {
    if (ch === " " || glyphs[ch]) out += ch;
    else {
      const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += plain && glyphs[plain] ? plain : "";
    }
  }
  return out;
}

/** Horizontal advance of a string in world units at `size`. */
export function advanceOf(text: string, size: number): number {
  const data = getFont().data as unknown as { resolution: number; glyphs: Record<string, { ha: number }> };
  let w = 0;
  for (const ch of text) w += data.glyphs[ch]?.ha ?? data.resolution * 0.3;
  return (w / data.resolution) * size;
}

export type TextOpts = {
  size: number;
  depth: number;
  bevel?: number;
  bevelSegments?: number;
  curveSegments?: number;
};

export function textGeometry(text: string, o: TextOpts): BufferGeometry {
  const bevel = o.bevel ?? 0;
  return new TextGeometry(drawableText(text), {
    font: getFont(),
    size: o.size,
    depth: o.depth,
    curveSegments: o.curveSegments ?? 4,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.7,
    bevelOffset: 0,
    bevelSegments: o.bevelSegments ?? 3,
  });
}
