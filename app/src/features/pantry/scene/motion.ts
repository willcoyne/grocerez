/**
 * Pure motion math for the pantry scene (no three.js / React imports, so it is unit-testable in Jest):
 * phase clock type, camera framing distances, scroll bounds, easing and the shelf-scroll physics.
 */
import type { PantryPhase } from "../types";
import { CAMERA_FOV } from "./sceneConfig";
import { COLUMN_WIDTH } from "./shelves/layout";

/** Linear phase progress shared between the phase driver (PantryScreen) and the rig/exterior. */
export type PhaseClock = {
  /** doors, 0 closed .. 1 open (linear; ease before use) */
  open: number;
  /** camera, 0 exterior framing .. 1 inside the shelves (linear) */
  zoom: number;
  /**
   * `list` phase, 0 closed framing .. 1 note lifted in front of the camera (linear). The camera flies to the note over
   * the first part, the paper lifts off its pin over the last part (exterior/animation.ts LIST_* constants).
   */
  list: number;
};

export type Vec3 = [number, number, number];

/**
 * A flipped item's back label in shelf-local space: centre (x, y), the z of its front face, and its flat size.
 * See food/backPanel.ts `flippedLabelFrame` (relative to the item) + the item's shelf position.
 */
export type LabelFocus = { x: number; y: number; z: number; width: number; height: number };

/** Shelf-local point to centre on (search fly-to); with `label`, the camera zooms right onto that label (item tap). */
export type CameraFocus = { x: number; y: number; label?: LabelFocus } | null;

/** tan(vertical fov / 2) */
export const TAN = Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);
/**
 * Shelves phase: the column's outer width (uprights included) is COLUMN_OVERFILL times the visible width at the shelf
 * front plane, so the uprights bleed just past both screen edges and no wall shows at the sides (1.02 = 2% overfill).
 */
export const COLUMN_OVERFILL = 1.02;
const SHELF_HALF_W = COLUMN_WIDTH / 2 / COLUMN_OVERFILL;
/** Minimum visible half-height in the shelves phase (scaled down below aspect 1, so width wins on portrait screens). */
const SHELF_MIN_HALF_H = 1.6;
/** Filler shelf visible above the top section at scroll min, and below the last one at max. */
const TOP_PAD = 0.3;
const BOTTOM_PAD = 0.5;
/** How close the camera gets to a searched item (fraction of the normal distance). */
export const FOCUS_ZOOM = 0.72;

/** `list` clock: the camera flies during [0, LIST_CAMERA_END]; the paper lifts off its pin during [LIST_LIFT_START, 1]. */
export const LIST_CAMERA_END = 0.6;
export const LIST_LIFT_START = 0.45;

/**
 * `closing` (clock.zoom 1 → 0) runs the opening's hand-off in reverse: the camera first glides from wherever the shelves
 * view was into the doorway pose (only the opening fills the view) with the exterior still hidden and the shelves
 * unclipped, and only then is the exterior shown / the column clipped and the camera pulls back to the closed framing.
 * Showing the exterior at the shelves view instead popped the pantry frame, plinth and floor over the shelves the
 * camera saw beyond the opening (on a phone that view spans y -0.6..3.2; the opening is 0.15..2.95).
 * CLOSE_TO_DOOR is the fraction of the pull spent reaching the doorway (~0.33 s of 1.1 s, just before the doors move).
 */
export const CLOSE_TO_DOOR = 0.3;

/** Which leg of the closing camera path a `zoom` clock value is on, and its eased progress along that leg. */
export function closingCamera(zoom: number): { toDoor: boolean; e: number } {
  const u = clamp(1 - zoom, 0, 1);
  if (u < CLOSE_TO_DOOR) return { toDoor: true, e: easeInOutCubic(u / CLOSE_TO_DOOR) };
  return { toDoor: false, e: easeInOutCubic((u - CLOSE_TO_DOOR) / (1 - CLOSE_TO_DOOR)) };
}

/**
 * Whether the exterior is shown (and the shelf column clipped to the opening) this frame. Hidden in `shelves` (the
 * column then looks endless) and during the doorway leg of `closing`; switching only happens at the doorway pose.
 */
export function exteriorShown(phase: PantryPhase, zoom: number): boolean {
  if (phase === "shelves") return false;
  if (phase === "closing") return !closingCamera(zoom).toDoor;
  return true;
}

/** Fraction of the screen width the pinned list should fill when the camera flies to it. */
export const NOTE_FILL = 0.7;

/** Camera distance from the note's plane that makes a `w` x `h` note fill NOTE_FILL of the width (and fit vertically). */
export function noteDistance(w: number, h: number, aspect: number) {
  return Math.max(w / NOTE_FILL / 2 / (TAN * aspect), h / 0.8 / 2 / TAN);
}

/** Fraction of the viewport the flipped back label fills (width, or height when the label is relatively taller). */
export const LABEL_FILL = 0.82;

/** Camera distance from a `w` x `h` label so it fills LABEL_FILL of the width or height, whichever binds first. */
export function labelDistance(w: number, h: number, aspect: number) {
  return Math.max(w / LABEL_FILL / 2 / (TAN * aspect), h / LABEL_FILL / 2 / TAN);
}

/** Item z on the shelf the normal shelves view looks toward (shelf-local). */
export const SHELF_LOOK_Z = -0.2;

/**
 * Where the shelves-phase camera should be for a focus (all shelf-local; the rig smooths toward it and adds the shelf
 * origin): `x` and the look-at x, `camZ` camera z, `lookZ` look-at z, and `y` when the camera must sit at a fixed
 * height (the label) instead of following the scroll.
 *  - no focus: straight on at the normal distance;
 *  - search fly-to: 70% of the way toward the item's x, FOCUS_ZOOM of the distance;
 *  - flipped label: straight on to the label, close enough that it fills LABEL_FILL of the view.
 */
export function shelfFocusTarget(f: CameraFocus, aspect: number): { x: number; camZ: number; lookZ: number; y: number | null } {
  const d = shelfDistance(aspect);
  if (!f) return { x: 0, camZ: d, lookZ: SHELF_LOOK_Z, y: null };
  const L = f.label;
  if (!L) return { x: f.x * 0.7, camZ: d * FOCUS_ZOOM, lookZ: SHELF_LOOK_Z, y: null };
  return { x: L.x, camZ: L.z + labelDistance(L.width, L.height, aspect), lookZ: L.z, y: L.y };
}

export function fitDistance(halfW: number, halfH: number, aspect: number) {
  return Math.max(halfH / TAN, halfW / (TAN * aspect));
}

/** Fraction of the scene a station sheet leaves visible at the top (features/stations StationSheet default). */
export const SHEET_PEEK = 0.25;
/** Room stations glide over this long (s); reduced motion cuts. */
export const STATION_GLIDE_S = 0.95;

/**
 * Straight-on camera pose that frames a room station inside the TOP `visible` fraction of the viewport (the part a
 * station sheet leaves uncovered): the `fitWidth` x `fitHeight` rectangle around `focus` fills at most `fill` of that
 * strip and is centred in it. `visible = 1` is the plain full-screen framing (same rule as `fitDistance`).
 */
export function stationPeekPose(
  station: { focus: Vec3; fitWidth: number; fitHeight: number },
  aspect: number,
  visible = SHEET_PEEK,
  fill = 0.88,
): { position: Vec3; target: Vec3; distance: number } {
  const f = clamp(visible, 0.05, 1);
  const k = clamp(fill, 0.1, 1);
  const distance = Math.max(station.fitHeight / 2 / (TAN * f * k), station.fitWidth / 2 / (TAN * aspect * k));
  // Lower the view centre so the focus sits in the middle of the top strip: strip centre = centre + h·(1 − f).
  const drop = distance * TAN * (1 - f);
  const [x, y, z] = station.focus;
  return { position: [x, y - drop, z + distance], target: [x, y - drop, z], distance };
}

/**
 * Normal viewing distance from the shelf front plane in the shelves phase: the column's width fills the screen
 * (COLUMN_OVERFILL) for the current aspect. The minimum visible height is scaled by min(1, aspect); on phones (aspect
 * below ~0.7) width binds, so there are no side gaps, while landscape keeps the full minimum height.
 */
export function shelfDistance(aspect: number) {
  return fitDistance(SHELF_HALF_W, SHELF_MIN_HALF_H * Math.min(1, aspect), aspect);
}

/** Scroll bounds (centre convention) for a given content height and aspect. */
export function shelfScrollBounds(contentHeight: number, aspect: number) {
  const halfView = shelfDistance(aspect) * TAN;
  const min = halfView - TOP_PAD;
  const max = Math.max(min, contentHeight - halfView + BOTTOM_PAD);
  return { min, max, viewHeight: halfView * 2 };
}

export type ScrollState = {
  y: number;
  v: number;
  dragging: boolean;
  /** y at drag start and the raw (un-rubber-banded) drag offset */
  dragStart: number;
  tween: { from: number; to: number; t: number; dur: number } | null;
};

export type ScrollBounds = { min: number; max: number };

/** Fling deceleration rate (1/s). */
const FRICTION = 3.4;
/** Spring-back rate when past a bound (1/s). */
const SPRING = 11;
/** Max overscroll distance (world units) while dragging. */
const RUBBER_LIMIT = 0.9;
/** Publish a new React `scrollY` when the live value moves this far. */
export const PUBLISH_STEP = 0.25;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** iOS-style rubber band: distance past the edge shrinks asymptotically towards `limit`. */
export function rubberBand(over: number, limit = RUBBER_LIMIT): number {
  const s = Math.sign(over);
  const d = Math.abs(over);
  return s * (limit * d) / (limit + d);
}

/** Position for a raw drag value, rubber-banded outside the bounds. */
export function applyRubber(raw: number, b: ScrollBounds): number {
  if (raw < b.min) return b.min + rubberBand(raw - b.min);
  if (raw > b.max) return b.max + rubberBand(raw - b.max);
  return raw;
}

/** Advance the free (not dragging) scroll by `dt` seconds. Pure apart from mutating `s`. */
export function stepScroll(s: ScrollState, dt: number, b: ScrollBounds): void {
  if (s.dragging) return;
  if (s.tween) {
    const tw = s.tween;
    tw.t += dt;
    const k = tw.dur <= 0 ? 1 : clamp(tw.t / tw.dur, 0, 1);
    s.y = tw.from + (tw.to - tw.from) * easeInOutCubic(k);
    s.v = 0;
    if (k >= 1) s.tween = null;
    return;
  }
  const out = s.y < b.min ? b.min : s.y > b.max ? b.max : null;
  if (out !== null) {
    // Past an edge: kill velocity quickly and spring back.
    s.v *= Math.exp(-dt * 18);
    s.y += s.v * dt;
    s.y += (out - s.y) * (1 - Math.exp(-dt * SPRING));
    if (Math.abs(out - s.y) < 0.0005) s.y = out;
    return;
  }
  if (s.v === 0) return;
  s.y += s.v * dt;
  s.v *= Math.exp(-dt * FRICTION);
  if (Math.abs(s.v) < 0.02) s.v = 0;
}

