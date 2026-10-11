#!/usr/bin/env node
/**
 * GrocerPixel: an original 5x7 bitmap font (2 extra descender rows) drawn for GrocerEZ's "pixel" theme. This script
 * turns the glyph table below into a three.js typeface JSON (FontLoader / TextGeometry format).
 *
 *   node buildFont.mjs            write font.typeface.json next to this script
 *   node buildFont.mjs --check    exit 1 if font.typeface.json is missing or out of date
 *   node buildFont.mjs --preview "Grocer EZ"   print the text as ASCII art
 *
 * Metrics: one pixel is PX = 100 font units and resolution is 700, so the cap height (7 px) is exactly 1 em. That
 * matches helvetiker (cap height about 1.01 em), so a theme can swap fonts without resizing text. Advance = (bitmap
 * width + 1 px spacing) * PX. Rows 0..6 sit above the baseline (row 6 rests on it); rows 7..8 are descenders.
 *
 * Every lit pixel ends up as part of an axis-aligned rectangle: runs of lit pixels are merged horizontally, then
 * identical runs on consecutive rows are merged vertically (or the transposed order, whichever gives fewer
 * rectangles). Each rectangle is its own clockwise subpath (TrueType convention: solids clockwise in y-up), so three
 * makes a separate solid Shape per rectangle. There are no holes and no curves, so triangulation can't go wrong.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PX = 100;
export const RESOLUTION = 700;
const CAP_ROWS = 7;
const DESCENDER_ROWS = 2;

// prettier-ignore
/** '#' = lit pixel, '.' = empty. 7 rows (cap height) plus up to 2 descender rows. Width can vary per glyph. */
export const GLYPHS = {
  " ": ["..", "..", "..", "..", "..", "..", ".."],
  "!": ["#", "#", "#", "#", "#", ".", "#"],
  '"': ["#.#", "#.#", "...", "...", "...", "...", "..."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "$": ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "%": ["##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##"],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "'": ["#", "#", ".", ".", ".", ".", "."],
  "(": ["..#", ".#.", "#..", "#..", "#..", ".#.", "..#"],
  ")": ["#..", ".#.", "..#", "..#", "..#", ".#.", "#.."],
  "*": [".....", "..#..", "#.#.#", ".###.", "#.#.#", "..#..", "....."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  ",": ["..", "..", "..", "..", "..", ".#", ".#", "#."],
  "-": ["....", "....", "....", "####", "....", "....", "...."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ":": [".", ".", "#", ".", ".", "#", "."],
  ";": ["..", "..", ".#", "..", "..", ".#", ".#", "#."],
  "<": ["...#", "..#.", ".#..", "#...", ".#..", "..#.", "...#"],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  ">": ["#...", ".#..", "..#.", "...#", "..#.", ".#..", "#..."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".####"],
  "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  "D": ["###..", "#..#.", "#...#", "#...#", "#...#", "#..#.", "###.."],
  "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "I": ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  "N": ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
  "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  "S": [".###.", "#...#", "#....", ".###.", "....#", "#...#", ".###."],
  "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "[": ["###", "#..", "#..", "#..", "#..", "#..", "###"],
  "\\": ["#....", "#....", ".#...", "..#..", "...#.", "....#", "....#"],
  "]": ["###", "..#", "..#", "..#", "..#", "..#", "###"],
  "^": ["..#..", ".#.#.", "#...#", ".....", ".....", ".....", "....."],
  "_": [".....", ".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "`": ["#.", ".#", "..", "..", "..", "..", ".."],
  "a": [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  "b": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  "c": ["....", "....", ".###", "#...", "#...", "#...", ".###"],
  "d": ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  "e": [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  "f": ["..##", ".#..", "####", ".#..", ".#..", ".#..", ".#.."],
  "g": [".....", ".....", ".####", "#...#", "#...#", "#...#", ".####", "....#", ".###."],
  "h": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"],
  "i": [".#.", "...", "##.", ".#.", ".#.", ".#.", "###"],
  "j": ["...#", "....", "..##", "...#", "...#", "...#", "...#", "#..#", ".##."],
  "k": ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#"],
  "l": ["##.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  "m": [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"],
  "n": [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
  "o": [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  "p": [".....", ".....", "####.", "#...#", "#...#", "#...#", "####.", "#....", "#...."],
  "q": [".....", ".....", ".####", "#...#", "#...#", "#...#", ".####", "....#", "....#"],
  "r": ["....", "....", "#.##", "##..", "#...", "#...", "#..."],
  "s": [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  "t": [".#..", ".#..", "####", ".#..", ".#..", ".#..", "..##"],
  "u": [".....", ".....", "#...#", "#...#", "#...#", "#...#", ".####"],
  "v": [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  "w": [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
  "x": [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  "y": [".....", ".....", "#...#", "#...#", "#...#", "#...#", ".####", "....#", ".###."],
  "z": [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
  "{": ["..##", ".#..", ".#..", "#...", ".#..", ".#..", "..##"],
  "|": ["#", "#", "#", "#", "#", "#", "#"],
  "}": ["##..", "..#.", "..#.", "...#", "..#.", "..#.", "##.."],
  "~": [".....", ".....", ".#...", "#.#.#", "...#.", ".....", "....."],
  // Beyond ASCII: degree sign (fridge temperatures) and the typographic characters labels commonly contain.
  "°": [".#.", "#.#", ".#.", "...", "...", "...", "..."],
  "•": ["..", "..", "..", "##", "##", "..", ".."],
  "·": [".", ".", ".", "#", ".", ".", "."],
  "…": [".....", ".....", ".....", ".....", ".....", ".....", "#.#.#"],
  "–": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "—": [".......", ".......", ".......", "#######", ".......", ".......", "......."],
  "‘": ["#", "#", ".", ".", ".", ".", "."],
  "’": ["#", "#", ".", ".", ".", ".", "."],
  "“": ["#.#", "#.#", "...", "...", "...", "...", "..."],
  "”": ["#.#", "#.#", "...", "...", "...", "...", "..."],
  "×": [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."],
};

/** Throws if a glyph's rows are ragged, too tall/short, or use characters other than '#' and '.'. */
export function validateGlyph(ch, rows) {
  if (!Array.isArray(rows) || rows.length < CAP_ROWS || rows.length > CAP_ROWS + DESCENDER_ROWS) {
    throw new Error(`glyph ${JSON.stringify(ch)}: needs ${CAP_ROWS}..${CAP_ROWS + DESCENDER_ROWS} rows`);
  }
  const w = rows[0].length;
  for (const r of rows) {
    if (r.length !== w) throw new Error(`glyph ${JSON.stringify(ch)}: ragged rows`);
    if (!/^[#.]+$/.test(r)) throw new Error(`glyph ${JSON.stringify(ch)}: only '#' and '.' allowed`);
  }
}

/** Horizontal runs per row merged vertically when identical. Rect = { c0, c1, r0, r1 } (half-open cells). */
function mergeRuns(lit, rows, cols) {
  const done = [];
  let open = new Map();
  for (let r = 0; r < rows; r++) {
    const next = new Map();
    for (let c = 0; c < cols; ) {
      if (!lit(r, c)) {
        c++;
        continue;
      }
      const c0 = c;
      while (c < cols && lit(r, c)) c++;
      const key = `${c0}:${c}`;
      const prev = open.get(key);
      if (prev) {
        prev.r1 = r + 1;
        open.delete(key);
        next.set(key, prev);
      } else {
        next.set(key, { c0, c1: c, r0: r, r1: r + 1 });
      }
    }
    done.push(...open.values());
    open = next;
  }
  done.push(...open.values());
  return done;
}

/** Fewest rectangles of row-first vs column-first merging. Cells are [row][col] with row 0 at the top. */
export function glyphRects(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const byRow = mergeRuns((r, c) => rows[r][c] === "#", h, w);
  const byCol = mergeRuns((c, r) => rows[r][c] === "#", w, h).map((t) => ({ c0: t.r0, c1: t.r1, r0: t.c0, r1: t.c1 }));
  const pick = byCol.length < byRow.length ? byCol : byRow;
  return pick.sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);
}

/** One three.js typeface glyph: clockwise rectangle subpaths in font units (y up, baseline 0). */
export function buildGlyph(rows) {
  const w = rows[0].length;
  const rects = glyphRects(rows);
  const glyph = { ha: (w + 1) * PX, x_min: 0, x_max: 0 };
  if (!rects.length) return glyph;
  const parts = [];
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const { c0, c1, r0, r1 } of rects) {
    const x0 = c0 * PX;
    const x1 = c1 * PX;
    const yTop = (CAP_ROWS - r0) * PX;
    const yBottom = (CAP_ROWS - r1) * PX;
    xMin = Math.min(xMin, x0);
    xMax = Math.max(xMax, x1);
    // bottom-left -> top-left -> top-right -> bottom-right: clockwise with y up
    parts.push(`m ${x0} ${yBottom} l ${x0} ${yTop} l ${x1} ${yTop} l ${x1} ${yBottom}`);
  }
  glyph.x_min = xMin;
  glyph.x_max = xMax;
  glyph.o = parts.join(" ");
  return glyph;
}

export function buildFont() {
  const glyphs = {};
  let widest = 0;
  for (const [ch, rows] of Object.entries(GLYPHS)) {
    validateGlyph(ch, rows);
    glyphs[ch] = buildGlyph(rows);
    widest = Math.max(widest, rows[0].length);
  }
  return {
    glyphs,
    familyName: "GrocerPixel",
    ascender: CAP_ROWS * PX,
    descender: -DESCENDER_ROWS * PX,
    underlinePosition: -PX,
    underlineThickness: PX,
    boundingBox: { xMin: 0, yMin: -DESCENDER_ROWS * PX, xMax: widest * PX, yMax: CAP_ROWS * PX },
    resolution: RESOLUTION,
    cssFontWeight: "normal",
    cssFontStyle: "normal",
    original_font_information: {
      format: 0,
      full_font_name: "GrocerPixel Regular",
      font_family_name: "GrocerPixel",
      font_sub_family_name: "Regular",
      postscript_name: "GrocerPixel-Regular",
      version_string: "Version 1.0",
      copyright: "Original 5x7 bitmap glyphs drawn for GrocerEZ (theme/themes/pixel/buildFont.mjs).",
      description: "Generated by buildFont.mjs: every lit pixel becomes part of a square-cornered rectangle.",
    },
  };
}

/** Stable, compact serialisation (one glyph per line keeps diffs readable). */
export function serialize(font) {
  const { glyphs, ...rest } = font;
  const lines = Object.entries(glyphs).map(([ch, g]) => `    ${JSON.stringify(ch)}: ${JSON.stringify(g)}`);
  const head = JSON.stringify(rest, null, 2).slice(1, -1).trim();
  return `{\n  "glyphs": {\n${lines.join(",\n")}\n  },\n  ${head}\n}\n`;
}

export function preview(text) {
  const rows = Array.from({ length: CAP_ROWS + DESCENDER_ROWS }, () => "");
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS["?"];
    const w = g[0].length;
    for (let r = 0; r < rows.length; r++) rows[r] += (g[r] ?? ".".repeat(w)).replace(/\./g, " ") + " ";
  }
  return rows.map((r) => r.replace(/\s+$/, "")).join("\n");
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "font.typeface.json");
  const args = process.argv.slice(2);
  if (args[0] === "--preview") {
    console.log(preview(args.slice(1).join(" ") || "Grocer EZ"));
  } else {
    const json = serialize(buildFont());
    if (args[0] === "--check") {
      let current = "";
      try {
        current = readFileSync(out, "utf8");
      } catch {
        // missing file counts as out of date
      }
      if (current.replace(/\r\n/g, "\n") !== json) {
        console.error("font.typeface.json is out of date: run `node buildFont.mjs`");
        process.exit(1);
      }
      console.log("font.typeface.json is up to date");
    } else {
      writeFileSync(out, json);
      console.log(`wrote ${out} (${Object.keys(GLYPHS).length} glyphs)`);
    }
  }
}
