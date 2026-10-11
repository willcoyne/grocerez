/**
 * Where the back label is printed on each procedural item (pure; no three.js, unit-tested).
 *
 * The label is sized to the item's real back face from `geometries.ts` (inset from the edges) and follows that surface:
 * a flat panel on boxes/cartons, a band on cans/jars/bottles, a folded sticker over the cheese wedge's ridge, a small
 * oval PLU sticker on produce. `depthAt` gives the distance of the back surface behind the item origin (local z = -depth)
 * so the renderer can "decal" every label vertex straight onto it along z: seen head-on (as the zoomed camera sees it)
 * the label is exactly its flat layout, but it sits just off the package and follows its curvature.
 *
 * Item local frame (geometries.ts): base centre at the origin, resting on y = 0, front facing +z.
 */
import type { FoodKind, PantryItem } from "../../types";
import { FLIP_POP } from "./flipMotion";
import { foodKindFor, foodVariantFor, type FoodVariant } from "./foodKind";

export type BackSurface =
  /** flat back face at `depth`, its top/bottom edges rounded with radius `r` between y0..y1 */
  | { type: "box"; depth: number; y0: number; y1: number; r: number }
  /** flat face tilted back: depth = depth + slope * (y - y0) (the open egg-carton lid) */
  | { type: "tilted"; depth: number; y0: number; slope: number }
  /** vertical-axis surface of revolution about x = z = 0, radius linear from r0 at y0 to r1 at y1 */
  | { type: "lathe"; y0: number; r0: number; y1: number; r1: number }
  | { type: "ellipsoid"; cx: number; cy: number; cz: number; rx: number; ry: number; rz: number }
  /** the chips bag's pillow bulge */
  | { type: "pillow" }
  /** cheese wedge seen from behind: a vertical ridge at x = apexX */
  | { type: "ridge"; apexX: number; depth: number; leftSlope: number; rightSlope: number }
  /** bread loaf: flat lower back + rounded crown */
  | { type: "loaf" };

export type BackPanel = {
  /** packaged-food nutrition panel (rectangle) or a produce PLU sticker (oval) */
  style: "panel" | "produce";
  /** flat (projected) size of the label, world units */
  width: number;
  height: number;
  /** label centre in item-local x / y (before the flip) */
  cx: number;
  cy: number;
  surface: BackSurface;
};

/** Distance the label floats off the package surface (no z-fighting, still reads as printed). */
export const LABEL_GAP = 0.0015;

const box = (depth: number, y0: number, y1: number, r: number): BackSurface => ({ type: "box", depth, y0, y1, r });
const lathe = (r: number, y0 = 0, y1 = 0.4, r1 = r): BackSurface => ({ type: "lathe", y0, r0: r, y1, r1 });
const ell = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): BackSurface => ({ type: "ellipsoid", cx, cy, cz, rx, ry, rz });
const panel = (width: number, height: number, cy: number, surface: BackSurface, cx = 0): BackPanel => ({ style: "panel", width, height, cx, cy, surface });
const sticker = (width: number, height: number, cy: number, surface: BackSurface, cx = 0): BackPanel => ({ style: "produce", width, height, cx, cy, surface });

/** Per kind (and variant) label placement. Dimensions mirror geometries.ts; keep them in sync when shapes change. */
const PANELS: Partial<Record<FoodKind, Partial<Record<FoodVariant, BackPanel>>>> = {
  // bag body 0.26 x 0.30 (y 0.025..0.325), bulging up to 0.06 deep
  chips: { default: panel(0.16, 0.19, 0.175, { type: "pillow" }) },
  // 0.22 x 0.34 x 0.08 box
  box: { default: panel(0.19, 0.29, 0.17, box(0.04, 0, 0.34, 0.012)) },
  // printed band of the can, r 0.0716, y 0.025..0.145
  can: { default: panel(0.09, 0.1, 0.085, lathe(0.0716)) },
  // jar body r 0.082 with a paper band r 0.0835
  jar: { default: panel(0.11, 0.095, 0.085, lathe(0.0835)) },
  // bottle body r 0.06 with a label band r 0.0615 (y 0.06..0.14)
  bottle: { default: panel(0.085, 0.115, 0.1, lathe(0.0618)) },
  // 0.13 x 0.20 x 0.13 carton below the gable
  carton: { default: panel(0.11, 0.17, 0.1, box(0.065, 0, 0.2, 0.006)) },
  // back of the open lid (tipped -1.85 rad about its hinge at y 0.06, z -0.07)
  eggs: { default: panel(0.16, 0.105, 0.125, { type: "tilted", depth: 0.0815, y0: 0.0567, slope: 0.2867 }) },
  // wedge apex (x 0.02, z -0.105) with faces sloping to the front corners
  cheese: { default: panel(0.12, 0.1, 0.085, { type: "ridge", apexX: 0.02, depth: 0.105, leftSlope: 1.032, rightSlope: 1.391 }, 0.02) },
  // back of the shrink wrap, 0.31 x 0.12 x 0.21, rounded r 0.03
  meat: { default: panel(0.13, 0.085, 0.06, box(0.105, 0, 0.12, 0.03)) },
  // deli sticker on the fish body (ellipsoid 0.12 x 0.055 x 0.032)
  fish: { default: panel(0.09, 0.058, 0.075, ell(0.01, 0.075, 0, 0.12, 0.055, 0.032), 0.01) },
  bread: {
    default: panel(0.14, 0.1, 0.07, { type: "loaf" }),
    bagel: panel(0.09, 0.1, 0.085, lathe(0.086)),
    flat: panel(0.17, 0.17, 0.125, box(0.0395, 0, 0.25, 0.03)),
    bun: panel(0.08, 0.05, 0.105, ell(0, 0.097, -0.005, 0.08, 0.06, 0.08)),
  },
  fruit: {
    // top apple of the pile
    default: sticker(0.075, 0.056, 0.147, ell(0, 0.1469, -0.012, 0.064, 0.0589, 0.064)),
    // rides a little proud of the back banana (its ends curve up), so the sticker never dips into the peel
    banana: sticker(0.046, 0.029, 0.03, ell(0, 0.028, -0.035, 0.06, 0.03, 0.027)),
    // on the clamshell
    berries: sticker(0.1, 0.05, 0.038, box(0.075, 0, 0.07, 0.008)),
    melon: sticker(0.09, 0.068, 0.12, ell(0, 0.11, 0, 0.15, 0.1095, 0.12)),
    pineapple: sticker(0.075, 0.056, 0.12, ell(0, 0.12, 0, 0.085, 0.119, 0.085)),
  },
  veg: {
    default: sticker(0.072, 0.052, 0.139, ell(0, 0.1394, -0.012, 0.064, 0.0544, 0.064)),
    carrot: sticker(0.05, 0.03, 0.03, ell(-0.04, 0.03, -0.04, 0.12, 0.023, 0.023), -0.04),
    long: sticker(0.06, 0.038, 0.038, ell(0, 0.034, -0.036, 0.134, 0.034, 0.034)),
    floret: sticker(0.055, 0.04, 0.13, ell(0, 0.13, -0.05, 0.048, 0.048, 0.048)),
  },
  leafy: {
    default: sticker(0.045, 0.028, 0.045, lathe(0.033)), // tag on the twist-tie band
    head: sticker(0.085, 0.065, 0.1, ell(0, 0.1, 0, 0.11, 0.11, 0.11)),
  },
  // tub tapering from r 0.082 (bottom) to 0.1 (top, y 0.15)
  icecream: { default: panel(0.12, 0.11, 0.08, lathe(0.0832, 0, 0.15, 0.1012)) },
  // 0.26 x 0.28 x 0.06 box
  frozenbox: { default: panel(0.22, 0.22, 0.14, box(0.03, 0, 0.28, 0.008)) },
  // 0.2 x 0.2 x 0.14 box
  generic: { default: panel(0.17, 0.16, 0.1, box(0.07, 0, 0.2, 0.02)) },
};

/** Label placement for an item shape. */
export function backPanelFor(kind: FoodKind, variant: FoodVariant = "default"): BackPanel {
  const byVariant = PANELS[kind] ?? PANELS.generic!;
  return byVariant[variant] ?? byVariant.default ?? PANELS.generic!.default!;
}

/** Every (kind, variant) that has its own placement (tests iterate this). */
export function allBackPanels(): { kind: FoodKind; variant: FoodVariant; panel: BackPanel }[] {
  const out: { kind: FoodKind; variant: FoodVariant; panel: BackPanel }[] = [];
  for (const [kind, byVariant] of Object.entries(PANELS) as [FoodKind, Partial<Record<FoodVariant, BackPanel>>][]) {
    for (const [variant, p] of Object.entries(byVariant) as [FoodVariant, BackPanel][]) out.push({ kind, variant, panel: p });
  }
  return out;
}

const sq = (v: number) => v * v;

/** Distance of the back surface behind the item origin at local (x, y). Positive = behind (local z = -depth). */
export function depthAt(s: BackSurface, x: number, y: number): number {
  switch (s.type) {
    case "box": {
      // rounded top/bottom edges: inside the corner band the face falls away along a quarter circle
      const dy = Math.max(0, s.y0 + s.r - y, y - (s.y1 - s.r));
      return s.depth - s.r + Math.sqrt(Math.max(0, sq(s.r) - sq(Math.min(dy, s.r))));
    }
    case "tilted":
      return s.depth + s.slope * (y - s.y0);
    case "lathe": {
      const t = Math.min(1, Math.max(0, (y - s.y0) / (s.y1 - s.y0)));
      const r = s.r0 + (s.r1 - s.r0) * t;
      return Math.sqrt(Math.max(0, sq(r) - sq(x)));
    }
    case "ellipsoid": {
      const k = 1 - sq((x - s.cx) / s.rx) - sq((y - s.cy) / s.ry);
      return -s.cz + s.rz * Math.sqrt(Math.max(0, k));
    }
    case "pillow": {
      // geometries.ts chips(): body 0.26 x 0.30 centred at y 0.175, z = ±(0.006 + 0.054 * bulge)
      const nx = Math.min(1, Math.abs(x) / 0.13);
      const ny = Math.min(1, Math.abs(y - 0.175) / 0.15);
      const bulge = Math.pow(Math.max(0, 1 - ny * ny), 0.6) * Math.sqrt(Math.max(0, 1 - Math.pow(nx, 4)));
      return 0.006 + 0.054 * bulge;
    }
    case "ridge": {
      const dx = x - s.apexX;
      return Math.max(0, s.depth - Math.abs(dx) * (dx < 0 ? s.leftSlope : s.rightSlope));
    }
    case "loaf": {
      // geometries.ts bread(): box 0.27 x 0.09 x 0.14 + crown cylinder (centre y 0.09, ry 0.054, rz 0.072)
      const crown = 0.072 * Math.sqrt(Math.max(0, 1 - sq((y - 0.09) / 0.054)));
      return Math.max(y <= 0.09 ? 0.07 : 0, crown);
    }
  }
}

/** World-space-relative frame of the label once the item is flipped (half turn about Y) and nudged forward. */
export type LabelFrame = {
  /** label centre relative to the item base, after the flip */
  x: number;
  y: number;
  /** front of the label (toward the viewer) relative to the item base */
  z: number;
  width: number;
  height: number;
};

/**
 * Where the label ends up when the item is fully flipped: the half turn maps local (x, y, z) to (-x, y, -z), then the
 * whole item is nudged FLIP_POP.forward toward the viewer.
 */
export function flippedLabelFrame(p: BackPanel): LabelFrame {
  return {
    x: -p.cx,
    y: p.cy + FLIP_POP.lift,
    // nearest point of the label (a tilted lid leans its top toward the viewer) so the zoom never overfills
    z: Math.max(...[-0.5, 0, 0.5].map((k) => depthAt(p.surface, p.cx, p.cy + k * p.height))) + LABEL_GAP + FLIP_POP.forward,
    width: p.width,
    height: p.height,
  };
}

/** Flipped-label frame for a pantry item (same kind/variant pick as FoodItem). */
export function itemLabelFrame(item: Pick<PantryItem, "name" | "brand" | "category" | "location">): LabelFrame {
  const kind = foodKindFor(item);
  return flippedLabelFrame(backPanelFor(kind, foodVariantFor(item, kind)));
}
