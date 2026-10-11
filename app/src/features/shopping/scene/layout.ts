/**
 * Store aisle layout (pure math; no three.js). World frame:
 *   x runs down the aisle (left → right, the shopper walks towards +x), floor at y = 0,
 *   the gondola's front edge at z = 0 (shelves go back to z = -SHELF_DEPTH), the camera stands at +z.
 * Each non-empty aisle section is a run of gondola with LEVELS shelves; items fill eye-level shelves first.
 */
import type { StoreSection } from "../mapping";

export const LEVELS = 4;
/** Shelf top surfaces, bottom to top. */
export const LEVEL_Y = [0.14, 0.62, 1.1, 1.58] as const;
/** Fill order: eye level, then waist, top, bottom. */
const LEVEL_ORDER = [2, 1, 3, 0] as const;
export const COL_W = 0.46;
export const SECTION_PAD = 0.26;
export const MIN_COLS = 2;
export const SHELF_DEPTH = 0.55;
/** Item centre depth on the shelf. */
export const ITEM_Z = -0.24;
export const GONDOLA_TOP = 2.02;
export const SIGN_Y = 2.62;
export const CEILING_Y = 3.5;
/** Entrance endcap with the store logo, before the first section. */
export const ENTRANCE_W = 1.6;
/** Filler shelving drawn past both ends so the aisle feels endless. */
export const FILLER_W = 4;

export type SlotPos = { x: number; y: number; z: number };

export type AisleSectionLayout = StoreSection & {
  x0: number;
  x1: number;
  slots: SlotPos[];
};

export type AisleLayout = {
  sections: AisleSectionLayout[];
  /** row id → shelf slot (world) */
  slotById: Map<string, SlotPos>;
  /** first/last x of real content (entrance included) */
  start: number;
  end: number;
};

export function columnsFor(n: number) {
  return Math.max(MIN_COLS, Math.ceil(n / LEVELS));
}

export function sectionWidth(n: number) {
  return SECTION_PAD * 2 + columnsFor(n) * COL_W;
}

export function buildAisleLayout(sections: StoreSection[]): AisleLayout {
  const out: AisleSectionLayout[] = [];
  const slotById = new Map<string, SlotPos>();
  let x = 0;
  for (const s of sections) {
    const w = sectionWidth(s.items.length);
    const slots = s.items.map((it, i) => {
      const col = Math.floor(i / LEVELS);
      const level = LEVEL_ORDER[i % LEVELS];
      const pos = { x: x + SECTION_PAD + COL_W * (col + 0.5), y: LEVEL_Y[level], z: ITEM_Z };
      slotById.set(it.row.id, pos);
      return pos;
    });
    out.push({ ...s, x0: x, x1: x + w, slots });
    x += w;
  }
  return { sections: out, slotById, start: -ENTRANCE_W, end: Math.max(x, 0) };
}

// ---- camera framing ----

export const CAMERA_FOV = 42;
const TAN = Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);
/** Shopper eye height and the point on the shelves the camera looks at. */
export const EYE_Y = 1.62;
export const LOOK_Y = 1.18;
/** Minimum half extents of the gondola face to keep in view. */
const HALF_W = 1.05;
const HALF_H = 1.45;

/** Camera distance from the shelf front (z = 0). Portrait screens fit the width, landscape the height. */
export function cameraDistance(aspect: number) {
  return Math.max(HALF_H / TAN, HALF_W / (TAN * Math.max(aspect, 0.1)));
}

/** Half the visible width at depth `dist` from the camera. */
export function halfWidthAt(dist: number, aspect: number) {
  return dist * TAN * aspect;
}

export function halfHeightAt(dist: number) {
  return dist * TAN;
}

/** Scroll bounds (x of the view centre) so the entrance logo shows at min and the last section at max. */
export function aisleScrollBounds(layout: Pick<AisleLayout, "start" | "end">, aspect: number) {
  const hw = halfWidthAt(cameraDistance(aspect), aspect);
  const min = layout.start + hw - 0.2;
  const max = Math.max(min, layout.end - hw + 0.35);
  return { min, max, halfWidth: hw };
}

/** Where the cart sits relative to the camera: in front, bottom-right, at hand height. */
export const CART_DEPTH = 2.6;
export const CART_SCALE = 0.62;
export function cartOffset(aspect: number) {
  const hw = halfWidthAt(CART_DEPTH, aspect);
  // Keep the cart's right edge a little inside the screen; on wide screens don't drift too far right.
  const x = Math.max(0, Math.min(hw - 0.36 * CART_SCALE * 1.6, 1.4));
  return { x, y: 0, z: -CART_DEPTH };
}

// ---- hop arc ----

export const HOP_MS = 600;

/** Ballistic arc between two points; t in [0,1]. Writes into `out` and returns it. */
export function arcPoint(from: SlotPos, to: SlotPos, t: number, height: number, out: SlotPos): SlotPos {
  const k = Math.min(1, Math.max(0, t));
  out.x = from.x + (to.x - from.x) * k;
  out.z = from.z + (to.z - from.z) * k;
  out.y = from.y + (to.y - from.y) * k + 4 * height * k * (1 - k);
  return out;
}

/** Decaying bounce for the cart (and a landed item): 0 at rest. `s` = seconds since landing. */
export function bounce(s: number) {
  if (s < 0 || s > 0.9) return 0;
  return Math.exp(-s * 6) * Math.sin(s * 22);
}
