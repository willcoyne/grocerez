/** Pure timing/pose maths for the item flip (no three.js; unit-tested). */

/** Seconds for the 180° flip to the back label (and back). */
export const FLIP_DURATION_S = 0.6;
/**
 * While flipped the item only nudges toward the viewer (clears the shelf lip) and turns in place: no lift, no scale, so it
 * never covers its neighbours. The camera zooms onto the label instead (motion.ts shelfFocusTarget).
 */
export const FLIP_POP = { forward: 0.06, lift: 0, arc: 0.012 } as const;

/** easeInOutCubic */
export function flipEase(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Advance linear flip progress toward `target` (0 front, 1 back) by `dt` seconds. */
export function stepFlip(progress: number, target: 0 | 1, dt: number): number {
  const step = Math.min(dt, 0.1) / FLIP_DURATION_S; // clamp dt so a stalled frame doesn't teleport
  return target > progress ? Math.min(target, progress + step) : Math.max(target, progress - step);
}

/** Pose of the flip/nudge groups for an eased progress `e` ∈ [0,1] (a tiny hop mid-turn, none at rest). */
export function flipPose(e: number) {
  return {
    rotY: Math.PI * e,
    z: FLIP_POP.forward * e,
    y: FLIP_POP.lift * e + FLIP_POP.arc * Math.sin(Math.PI * e),
  };
}
