#!/usr/bin/env node
// Builds diner/font.typeface.json: GrocerEZ "Retro", a bold rounded geometric typeface for 3D text in the diner
// theme (theme.font === "retro"). Deterministic.
//
//   node src/features/theme/themes/diner/buildFont.mjs [--preview out.svg]
//
// Same skeleton table as the sketch font (../sketch/strokeGlyphs.mjs) but built from squircle bowls (rounded
// rectangles, superellipse n = 3.6), wide 1950s sign proportions, a tall x-height, slab I / J / 1, and a fat
// round pen with no jitter or slant. The shared outline engine lives in ../sketch/strokeFont.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildTypeface, previewSvg } from "../sketch/strokeFont.mjs";
import { strokeGlyphs } from "../sketch/strokeGlyphs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const RETRO = {
  radius: 80, // pen radius: 16% of cap height, bold but with open counters
  capHeight: 1000,
  skeleton: { X: 640, C: 880, A: 900, D: -250, n: 3.6, ow: 560, cw: 720, dw: 600, dotGap: 250, slab: true, splayM: false, degR: 150 },
};

export function buildRetroFont() {
  return buildTypeface({
    familyName: "GrocerEZ Retro",
    fullName: "GrocerEZ Retro Bold",
    description: "Bold rounded geometric sign lettering for the diner theme (squircle bowls, round pen).",
    subfamily: "Bold",
    cssFontWeight: "bold",
    seed: 1955,
    radius: RETRO.radius,
    capHeight: RETRO.capHeight,
    skeletonCap: RETRO.skeleton.C,
    sideBearing: 58,
    space: 300,
    glyphs: strokeGlyphs(RETRO.skeleton),
    cell: 5,
    tolerance: 1.0,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const font = buildRetroFont();
  const out = path.join(here, "font.typeface.json");
  fs.writeFileSync(out, JSON.stringify(font));
  const kb = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`wrote ${out} (${Object.keys(font.glyphs).length} glyphs, ${kb} KB)`);
  const pi = process.argv.indexOf("--preview");
  if (pi > 0) {
    fs.writeFileSync(
      process.argv[pi + 1],
      previewSvg(font, [
        "Grocer EZ  SNACKS  INGREDIENTS",
        "PRODUCE FRIDGE FREEZER -18°C 3°C",
        "Lay's Chips, Peanut Butter & Oreos!",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "abcdefghijklmnopqrstuvwxyz",
        "0123456789 :;,.-'!?°%/&()",
        "\"#$*+<=>@[\\]^_`{|}~ Milk 2% 50/50",
      ]),
    );
  }
}
