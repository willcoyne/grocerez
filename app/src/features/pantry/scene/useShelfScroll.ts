/**
 * Vertical scrolling of the infinite shelf column: drag with rubber-banding, fling with inertia, mouse wheel (web), and
 * animated `scrollTo` for search fly-to.
 *
 * Units are world units of the shelf column. Convention (same as ShelfColumn's `scrollY` prop, see shelves/layout.ts):
 * `scrollY` is how far the VIEW CENTRE is below the top of the column (y = 0), so the camera's shelf-local y is
 * `-scrollY`. The live value is in `state.current.y` and is advanced by `step(dt)` from the camera rig's useFrame (no
 * React render per frame). `scrollY` (React state) is a throttled copy for React consumers such as ShelfColumn's
 * virtualisation.
 *
 * Bounds are `[bounds.current.min, bounds.current.max]`; the camera rig updates them from the viewport size so the
 * top shelf sits at the top of the screen at min and the last shelf near the bottom at max. Gestures come from
 * react-native-gesture-handler (works on web and native); R3F's click filter (moves > 2 px are not clicks) keeps a
 * drag from also tapping an item.
 */
import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Gesture, type PanGesture } from "react-native-gesture-handler";

import { applyRubber, clamp, PUBLISH_STEP, stepScroll, type ScrollBounds, type ScrollState } from "./motion";

export { applyRubber, easeInOutCubic, rubberBand, stepScroll, type ScrollBounds, type ScrollState } from "./motion";

export type ShelfScroll = {
  /** throttled copy of the live position (React state) */
  scrollY: number;
  /** live state, mutated every frame */
  state: MutableRefObject<ScrollState>;
  bounds: MutableRefObject<ScrollBounds>;
  /** world units per screen pixel at the shelf front plane; set by the camera rig */
  pxToWorld: MutableRefObject<number>;
  /** called by the user when a drag/wheel starts (e.g. to drop a search focus) */
  onUserScroll: MutableRefObject<(() => void) | null>;
  /** animate (or jump) to y; returns the duration in seconds */
  scrollTo: (y: number, opts?: { animated?: boolean; duration?: number }) => number;
  /** advance physics; call once per frame */
  step: (dt: number) => void;
  /** web wheel delta in pixels */
  onWheel: (deltaY: number) => void;
  gesture: PanGesture;
};

export function useShelfScroll({ enabled, reducedMotion = false }: { enabled: boolean; reducedMotion?: boolean }): ShelfScroll {
  const state = useRef<ScrollState>({ y: 0, v: 0, dragging: false, dragStart: 0, tween: null });
  const bounds = useRef<ScrollBounds>({ min: 0, max: 0 });
  const pxToWorld = useRef(0.005);
  const onUserScroll = useRef<(() => void) | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const published = useRef(0);

  const publish = useCallback((force: boolean) => {
    const y = state.current.y;
    if (force ? y !== published.current : Math.abs(y - published.current) >= PUBLISH_STEP) {
      published.current = y;
      setScrollY(y);
    }
  }, []);

  const step = useCallback(
    (dt: number) => {
      const s = state.current;
      stepScroll(s, dt, bounds.current);
      const settled = !s.dragging && !s.tween && s.v === 0;
      publish(settled);
    },
    [publish],
  );

  const scrollTo = useCallback(
    (y: number, opts: { animated?: boolean; duration?: number } = {}) => {
      const s = state.current;
      const b = bounds.current;
      const to = clamp(y, b.min, Math.max(b.min, b.max));
      const animated = (opts.animated ?? true) && !reducedMotion;
      s.v = 0;
      s.dragging = false;
      if (!animated) {
        s.tween = null;
        s.y = to;
        publish(true);
        return 0;
      }
      const dist = Math.abs(to - s.y);
      const dur = opts.duration ?? clamp(0.35 + dist * 0.08, 0.35, 1.1);
      s.tween = { from: s.y, to, t: 0, dur };
      return dur;
    },
    [publish, reducedMotion],
  );

  const onWheel = useCallback(
    (deltaY: number) => {
      if (!enabled) return;
      const s = state.current;
      onUserScroll.current?.();
      s.tween = null;
      s.v = 0;
      const b = bounds.current;
      s.y = clamp(s.y + deltaY * pxToWorld.current, b.min, Math.max(b.min, b.max));
    },
    [enabled],
  );

  // Gesture callbacks run on the JS thread during gestures, never during render; the compiler can't see that.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(enabled)
        .minDistance(6)
        .activeOffsetY([-6, 6])
        .onStart(() => {
          const s = state.current;
          onUserScroll.current?.();
          s.tween = null;
          s.v = 0;
          s.dragging = true;
          s.dragStart = s.y;
        })
        .onUpdate((e) => {
          const s = state.current;
          if (!s.dragging) return;
          // Finger up (negative translation) moves the camera down the column (scrollY grows).
          s.y = applyRubber(s.dragStart - e.translationY * pxToWorld.current, bounds.current);
        })
        .onEnd((e) => {
          const s = state.current;
          s.dragging = false;
          s.v = reducedMotion ? 0 : clamp(-e.velocityY * pxToWorld.current, -25, 25);
        })
        .onFinalize(() => {
          state.current.dragging = false;
        }),
    [enabled, reducedMotion],
  );
  /* eslint-enable react-hooks/refs */

  return { scrollY, state, bounds, pxToWorld, onUserScroll, scrollTo, step, onWheel, gesture };
}
