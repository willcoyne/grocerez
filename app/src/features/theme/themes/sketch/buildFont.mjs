#!/usr/bin/env node
// Builds sketch/font.typeface.json: GrocerEZ "Hand", a felt-tip hand-lettered typeface for 3D text in the
// sketch theme (theme.font === "hand"). Deterministic: the same skeletons and seed give the same file.
//
//   node src/features/theme/themes/sketch/buildFont.mjs [--preview out.svg]
//
// Skeletons: strokeGlyphs.mjs (ellipse bowls, casual proportions). Then every glyph is slanted ~5°, turned and
// nudged a hair, and drawn with a wobbling, pressure-varying pen whose loops overshoot their start
// (strokeFont.mjs handJitter), so it reads like the team's pen drawings rather than a typed font.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildTypeface, previewSvg } from "./strokeFont.mjs";
import { strokeGlyphs } from "./strokeGlyphs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const HAND = {
  radius: 54, // pen radius (font units): ~11% of cap height, a felt-tip that stays legible on small tags
  capHeight: 1000,
  skeleton: { X: 580, C: 880, A: 930, D: -290, n: 2, ow: 470, cw: 640, dw: 520, dotGap: 210, splayM: true, slab: false },
  slantDeg: 5,
};

export function buildHandFont() {
  const scale = (HAND.capHeight - 2 * HAND.radius) / HAND.skeleton.C;
  const midY = HAND.radius + (HAND.skeleton.X * scale) / 2;
  const shear = Math.tan((HAND.slantDeg * Math.PI) / 180);
  const perGlyph = new Map();
  return buildTypeface({
    familyName: "GrocerEZ Hand",
    fullName: "GrocerEZ Hand Regular",
    description: "Felt-tip hand lettering for the sketch theme (single-stroke skeletons, jittered pen).",
    seed: 11,
    radius: HAND.radius,
    capHeight: HAND.capHeight,
    skeletonCap: HAND.skeleton.C,
    sideBearing: 52,
    space: 300,
    glyphs: strokeGlyphs(HAND.skeleton),
    transform: ([x, y], ch, rng, { ha }) => {
      if (!perGlyph.has(ch)) {
        perGlyph.set(ch, { rot: ((rng() - 0.5) * 3 * Math.PI) / 180, dy: (rng() - 0.5) * 22, sx: 1 + (rng() - 0.5) * 0.05 });
      }
      const { rot, dy, sx } = perGlyph.get(ch);
      const cx = ha / 2;
      const px = (x - cx) * sx, py = y - midY;
      const rx = px * Math.cos(rot) - py * Math.sin(rot);
      const ry = px * Math.sin(rot) + py * Math.cos(rot);
      return [cx + rx + ry * shear, midY + ry + dy];
    },
    jitter: { wobble: 11, wavelength: 400, pressure: 0.13, taper: 0.24, overshoot: 24, loopOverlap: 75, loopDrift: 15 },
    cell: 4,
    tolerance: 1.3,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const font = buildHandFont();
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
