/**
 * Horizontal scrolling down the store aisle: drag with rubber-banding, fling with inertia, mouse wheel (web) and an
 * animated `scrollTo` (Undo glides back to the item's shelf). Same physics as the pantry's vertical shelf scroll
 * (pantry/scene/motion.ts, imported read-only), but along x.
 *
 * `state.current.x` is the live x of the view centre, advanced by `step(dt)` from the camera rig's useFrame; `scrollX`
 * is a throttled React copy (section virtualisation). Bounds are kept up to date by the rig from the viewport size.
 */
import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Gesture, type PanGesture } from "react-native-gesture-handler";

import { applyRubber, clamp, PUBLISH_STEP, stepScroll, type ScrollBounds, type ScrollState } from "../../pantry/scene/motion";

export type AisleScroll = {
  scrollX: number;
  /** live state; `y` of the shared ScrollState holds the aisle x */
  state: MutableRefObject<ScrollState>;
  bounds: MutableRefObject<ScrollBounds>;
  pxToWorld: MutableRefObject<number>;
  scrollTo: (x: number, opts?: { animated?: boolean; duration?: number }) => number;
  step: (dt: number) => void;
  onWheel: (delta: number) => void;
  gesture: PanGesture;
};

export function useAisleScroll({ enabled, reducedMotion = false }: { enabled: boolean; reducedMotion?: boolean }): AisleScroll {
  // The pantry's ScrollState is axis-agnostic; its `y` field is our x.
  const state = useRef<ScrollState>({ y: 0, v: 0, dragging: false, dragStart: 0, tween: null });
  const bounds = useRef<ScrollBounds>({ min: -1e6, max: 1e6 });
  const pxToWorld = useRef(0.006);
  const [scrollX, setScrollX] = useState(0);
  const published = useRef(0);

  const publish = useCallback((force: boolean) => {
    const x = state.current.y;
    if (force ? x !== published.current : Math.abs(x - published.current) >= PUBLISH_STEP) {
      published.current = x;
      setScrollX(x);
    }
  }, []);

  const step = useCallback(
    (dt: number) => {
      const s = state.current;
      stepScroll(s, dt, bounds.current);
      publish(!s.dragging && !s.tween && s.v === 0);
    },
    [publish],
  );

  const scrollTo = useCallback(
    (x: number, opts: { animated?: boolean; duration?: number } = {}) => {
      const s = state.current;
      const b = bounds.current;
      const to = clamp(x, b.min, Math.max(b.min, b.max));
      s.v = 0;
      s.dragging = false;
      if (!(opts.animated ?? true) || reducedMotion) {
        s.tween = null;
        s.y = to;
        publish(true);
        return 0;
      }
      const dur = opts.duration ?? clamp(0.3 + Math.abs(to - s.y) * 0.08, 0.3, 1);
      s.tween = { from: s.y, to, t: 0, dur };
      return dur;
    },
    [publish, reducedMotion],
  );

  const onWheel = useCallback(
    (delta: number) => {
      if (!enabled) return;
      const s = state.current;
      const b = bounds.current;
      s.tween = null;
      s.v = 0;
      s.y = clamp(s.y + delta * pxToWorld.current, b.min, Math.max(b.min, b.max));
    },
    [enabled],
  );

  // Gesture callbacks run on the JS thread during gestures, never during render.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(enabled)
        .minDistance(6)
        .activeOffsetX([-6, 6])
        .onStart(() => {
          const s = state.current;
          s.tween = null;
          s.v = 0;
          s.dragging = true;
          s.dragStart = s.y;
        })
        .onUpdate((e) => {
          const s = state.current;
          if (!s.dragging) return;
          // Dragging the aisle left walks the shopper right (x grows).
          s.y = applyRubber(s.dragStart - e.translationX * pxToWorld.current, bounds.current);
        })
        .onEnd((e) => {
          const s = state.current;
          s.dragging = false;
          s.v = reducedMotion ? 0 : clamp(-e.velocityX * pxToWorld.current, -25, 25);
        })
        .onFinalize(() => {
          state.current.dragging = false;
        }),
    [enabled, reducedMotion],
  );
  /* eslint-enable react-hooks/refs */

  return { scrollX, state, bounds, pxToWorld, scrollTo, step, onWheel, gesture };
}
