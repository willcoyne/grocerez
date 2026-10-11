/**
 * Pure motion math for the pantry scene (no three.js / React imports, so it is unit-testable in Jest):
 * phase clock type, camera framing distances, scroll bounds, easing and the shelf-scroll physics.
 */
import { CAMERA_FOV } from "./sceneConfig";

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

/** Shelf-local point to centre on (search fly-to). */
export type CameraFocus = { x: number; y: number } | null;

/** tan(vertical fov / 2) */
export const TAN = Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);
/** Shelf column half-width to keep in view (column is 1.7 wide) and minimum visible half-height. */
const SHELF_HALF_W = 0.95;
const SHELF_MIN_HALF_H = 1.6;
/** Filler shelf visible above the top section at scroll min, and below the last one at max. */
const TOP_PAD = 0.3;
const BOTTOM_PAD = 0.5;
/** How close the camera gets to a searched item (fraction of the normal distance). */
export const FOCUS_ZOOM = 0.72;

/** `list` clock: the camera flies during [0, LIST_CAMERA_END]; the paper lifts off its pin during [LIST_LIFT_START, 1]. */
export const LIST_CAMERA_END = 0.6;
export const LIST_LIFT_START = 0.45;

/** Fraction of the screen width the pinned list should fill when the camera flies to it. */
export const NOTE_FILL = 0.7;

/** Camera distance from the note's plane that makes a `w` x `h` note fill NOTE_FILL of the width (and fit vertically). */
export function noteDistance(w: number, h: number, aspect: number) {
  return Math.max(w / NOTE_FILL / 2 / (TAN * aspect), h / 0.8 / 2 / TAN);
}

export function fitDistance(halfW: number, halfH: number, aspect: number) {
  return Math.max(halfH / TAN, halfW / (TAN * aspect));
}

/** Normal viewing distance from the shelf front plane in the shelves phase. */
export function shelfDistance(aspect: number) {
  return fitDistance(SHELF_HALF_W, SHELF_MIN_HALF_H, aspect);
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

