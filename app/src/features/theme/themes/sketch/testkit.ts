/**
 * Shared Jest checks for the sketch / neon / diner themes (imported only by their __tests__; never by app code).
 * - checkTheme: every token present and valid, readable contrast.
 * - checkTypeface: the generated three.js typeface covers every label character and survives three's own
 *   FontLoader -> ShapePath.toShapes -> triangulation path with nothing dropped (r186 drops contours that are
 *   wound the wrong way or overlap).
 * Owner: sketch / neon / diner theme designer.
 */
import { ShapeUtils, Vector2 } from "three";
import { Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";

import { contrastRatio, isHexColor } from "../../color";
import type { SceneTheme } from "../../types";

/** ASCII 32..126 plus the degree sign: everything shelf labels, name tags and fridge displays can contain. */
export const REQUIRED_CHARS = [...Array.from({ length: 95 }, (_, k) => String.fromCharCode(32 + k)), "°"];
/** Characters actually used in labels today (spec: A-Z a-z 0-9 and :,.-'!?°%/&()). */
export const LABEL_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:,.-'!?°%/&()";

export type TypefaceJson = {
  resolution: number;
  familyName: string;
  ascender: number;
  descender: number;
  underlineThickness: number;
  boundingBox: { xMin: number; xMax: number; yMin: number; yMax: number };
  glyphs: Record<string, { ha: number; x_min: number; x_max: number; o: string }>;
};

/** Parse a glyph outline ("m x y l x y ...") into closed contours. Throws on anything but m / l. */
export function parseOutline(o: string): [number, number][][] {
  const t = o.trim() ? o.trim().split(" ") : [];
  const contours: [number, number][][] = [];
  for (let i = 0; i < t.length; ) {
    const c = t[i++];
    const x = Number(t[i++]), y = Number(t[i++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`bad coordinate after "${c}"`);
    if (c === "m") contours.push([[x, y]]);
    else if (c === "l" && contours.length) contours[contours.length - 1].push([x, y]);
    else throw new Error(`unexpected command "${c}"`);
  }
  return contours;
}

const signed = (pts: [number, number][]) => {
  let a = 0;
  for (let p = pts.length - 1, q = 0; q < pts.length; p = q++) a += pts[p][0] * pts[q][1] - pts[q][0] * pts[p][1];
  return a / 2;
};

export type GlyphReport = { ch: string; contours: number; kept: number; expectedArea: number; triangulatedArea: number };

/** Run one glyph through three's pipeline and compare areas. */
export function glyphReport(font: Font, json: TypefaceJson, ch: string): GlyphReport {
  const contours = parseOutline(json.glyphs[ch].o);
  // Closed contours (last point repeats the first) wound solid = clockwise (negative area), hole = positive.
  const expectedArea = -contours.reduce((a, c) => a + signed(c), 0);
  const shapes = font.generateShapes(ch, json.resolution); // size == resolution -> font units
  let kept = 0;
  let triangulatedArea = 0;
  for (const shape of shapes) {
    const { shape: outer, holes } = shape.extractPoints(1);
    kept += 1 + holes.length;
    // triangulateShape drops duplicated closing points from `outer` / `holes` in place: index after it runs.
    const faces = ShapeUtils.triangulateShape(outer, holes);
    const verts: Vector2[] = [...outer, ...holes.flat()];
    for (const [a, b, c] of faces) {
      const A = verts[a], B = verts[b], C = verts[c];
      triangulatedArea += Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) / 2;
    }
  }
  return { ch, contours: contours.length, kept, expectedArea, triangulatedArea };
}

export function loadFont(json: TypefaceJson): Font {
  return new Font(json as unknown as FontData);
}

/** Advance width (font units) of a string, like three's FontLoader (missing glyphs fall back to "?"). */
export function advance(json: TypefaceJson, text: string): number {
  return Array.from(text).reduce((w, ch) => w + (json.glyphs[ch] ?? json.glyphs["?"]).ha, 0);
}

/** Vertical ink extent of a glyph. */
export function inkY(json: TypefaceJson, ch: string): { min: number; max: number } {
  const ys = parseOutline(json.glyphs[ch].o).flat().map(([, y]) => y);
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

/** Theme-level assertions shared by all three designs. Returns a list of problems (empty = valid). */
export function themeProblems(theme: SceneTheme): string[] {
  const problems: string[] = [];
  const hex = (path: string, v: unknown) => {
    if (!isHexColor(v)) problems.push(`${path} is not a hex colour: ${String(v)}`);
  };
  Object.entries(theme.palette).forEach(([k, v]) => hex(`palette.${k}`, v));
  const L = theme.lighting;
  [
    ["keyColor", L.keyColor],
    ["fillColor", L.fillColor],
    ["hemiSky", L.hemiSky],
    ["hemiGround", L.hemiGround],
    ["fridgeLight", L.fridgeLight],
    ["freezerLight", L.freezerLight],
  ].forEach(([k, v]) => hex(`lighting.${k}`, v));
  if (L.ambientColor !== undefined) hex("lighting.ambientColor", L.ambientColor);
  for (const k of ["keyIntensity", "fillIntensity", "hemiIntensity"] as const)
    if (!(L[k] >= 0 && L[k] <= 10)) problems.push(`lighting.${k} out of range: ${L[k]}`);
  hex("background", theme.background);
  if (theme.fog) {
    hex("fog.color", theme.fog.color);
    if (!(theme.fog.near > 0 && theme.fog.far > theme.fog.near)) problems.push("fog near/far invalid");
  }
  const ui = theme.ui;
  (["panel", "panelBorder", "text", "textMuted", "accent", "buttonFace", "buttonRing", "buttonIcon"] as const).forEach((k) =>
    hex(`ui.${k}`, ui[k]),
  );
  if (theme.swatches.length < 4 || theme.swatches.length > 5) problems.push("swatches must have 4-5 colours");
  theme.swatches.forEach((s, i) => hex(`swatches[${i}]`, s));
  if (theme.effects.outline) hex("effects.outline.color", theme.effects.outline.color);
  // Readability: body text and paper labels at WCAG AA, muted text and icons at least 3:1.
  if (contrastRatio(ui.text, ui.panel) < 4.5) problems.push("ui.text on ui.panel below 4.5:1");
  if (contrastRatio(ui.textMuted, ui.panel) < 4.5) problems.push("ui.textMuted on ui.panel below 4.5:1");
  if (contrastRatio(ui.buttonIcon, ui.buttonFace) < 3) problems.push("ui.buttonIcon on ui.buttonFace below 3:1");
  if (contrastRatio(theme.palette.ink, theme.palette.paper) < 4.5) problems.push("palette.ink on palette.paper below 4.5:1");
  if (!(theme.allergenGlow.periodS >= 0.34)) problems.push("allergen glow faster than 3 flashes per second");
  if (theme.materialStyle === "toon" && !(theme.toonSteps && theme.toonSteps >= 2 && theme.toonSteps <= 4))
    problems.push("toon themes need toonSteps 2-4");
  return problems;
}

/**
 * Jest suite for a generated stroke typeface: coverage, three.js round trip with nothing dropped, metrics close to
 * the bundled helvetiker (so it can stand in for it), and label widths that never exceed helvetiker's.
 */
export function typefaceSuite(json: TypefaceJson, helvetiker: TypefaceJson): void {
  const font = loadFont(json);

  it("draws every ASCII character, the degree sign and all label punctuation", () => {
    const missing = REQUIRED_CHARS.filter((ch) => !json.glyphs[ch]);
    expect(missing).toEqual([]);
    for (const ch of LABEL_CHARS) expect(json.glyphs[ch].o.length).toBeGreaterThan(0);
    for (const ch of REQUIRED_CHARS) expect(json.glyphs[ch].ha).toBeGreaterThan(0);
    expect(json.glyphs[" "].o).toBe("");
  });

  it("survives three's FontLoader and triangulation with no contour dropped", () => {
    const bad: string[] = [];
    for (const ch of REQUIRED_CHARS) {
      if (ch === " ") continue;
      const r = glyphReport(font, json, ch);
      const areaOk = Math.abs(r.triangulatedArea - r.expectedArea) <= r.expectedArea * 0.01;
      if (r.kept !== r.contours || !areaOk || r.expectedArea <= 0) bad.push(`${ch}: ${JSON.stringify(r)}`);
    }
    expect(bad).toEqual([]);
  });

  it("winds solids clockwise and holes counter-clockwise, closed, with integer coordinates", () => {
    for (const ch of REQUIRED_CHARS) {
      for (const c of parseOutline(json.glyphs[ch].o)) {
        expect(c.length).toBeGreaterThanOrEqual(4);
        expect(c[0]).toEqual(c[c.length - 1]);
        for (const [x, y] of c) expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      }
    }
    // "o" is one ring: a clockwise outer and a counter-clockwise counter
    const [outer, hole] = parseOutline(json.glyphs.o.o);
    expect(signed(outer)).toBeLessThan(0);
    expect(signed(hole)).toBeGreaterThan(0);
  });

  it("has helvetiker-like metrics (size ≈ cap height) and consistent bounds", () => {
    expect(json.resolution).toBe(1000);
    const H = inkY(json, "H"), x = inkY(json, "x"), p = inkY(json, "p");
    expect(Math.abs(H.min)).toBeLessThan(40);
    expect(H.max).toBeGreaterThan(940);
    expect(H.max).toBeLessThan(1080);
    expect(x.max).toBeGreaterThan(620);
    expect(x.max).toBeLessThan(820);
    expect(p.min).toBeLessThan(-180);
    const bb = json.boundingBox;
    for (const ch of REQUIRED_CHARS) {
      const g = json.glyphs[ch];
      if (!g.o) continue;
      const ys = inkY(json, ch);
      expect(ys.min).toBeGreaterThanOrEqual(bb.yMin);
      expect(ys.max).toBeLessThanOrEqual(bb.yMax);
      expect(g.x_min).toBeLessThanOrEqual(g.x_max);
    }
  });

  it("never sets labels wider than helvetiker bold, so existing layouts still fit", () => {
    for (const s of ["YOUR PANTRY IS EMPTY", "INGREDIENTS", "Peanut Butter", "Grocer", "-18°C", "Lay's Chips"]) {
      const ratio = advance(json, s) / advance(helvetiker, s);
      expect(ratio).toBeLessThanOrEqual(1);
      expect(ratio).toBeGreaterThan(0.6);
    }
  });

  it("extrudes 3D text with TextGeometry", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TextGeometry } = require("three/examples/jsm/geometries/TextGeometry.js");
    const g = new TextGeometry("Grocer 3°C", { font, size: 0.3, depth: 0.05, curveSegments: 2, bevelEnabled: false });
    g.computeBoundingBox();
    expect(g.getAttribute("position").count).toBeGreaterThan(100);
    expect(g.boundingBox.max.x).toBeGreaterThan(1);
    g.dispose();
  });
}

/** True when a tile wraps seamlessly: the jump across the wrap edge is no bigger than typical neighbour jumps. */
export function tilesSeamlessly(img: { width: number; height: number; data: Uint8Array }): boolean {
  const { width: w, height: h, data } = img;
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  };
  let inner = 0, wrapX = 0, wrapY = 0;
  for (let y = 0; y < h; y++) {
    inner += Math.abs(lum(1, y) - lum(0, y));
    wrapX += Math.abs(lum(0, y) - lum(w - 1, y));
  }
  for (let x = 0; x < w; x++) wrapY += Math.abs(lum(x, 0) - lum(x, h - 1));
  const tolerance = Math.max(inner * 2.5, h * 6);
  return wrapX <= tolerance && wrapY <= tolerance;
}
