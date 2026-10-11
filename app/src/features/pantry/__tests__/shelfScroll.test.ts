import { COLUMN_OVERFILL, shelfScrollBounds, shelfDistance, TAN } from "../scene/motion";
import { applyRubber, rubberBand, stepScroll, type ScrollState } from "../scene/motion";
import { COLUMN_WIDTH } from "../scene/shelves/layout";

const fresh = (y = 0, v = 0): ScrollState => ({ y, v, dragging: false, dragStart: y, tween: null });
const run = (s: ScrollState, seconds: number, b = { min: 0, max: 10 }) => {
  for (let t = 0; t < seconds; t += 1 / 60) stepScroll(s, 1 / 60, b);
};

describe("shelf scroll physics", () => {
  it("flings with inertia and comes to rest inside the bounds", () => {
    const s = fresh(2, 6);
    run(s, 0.1);
    expect(s.y).toBeGreaterThan(2.4);
    run(s, 4);
    expect(s.v).toBe(0);
    expect(s.y).toBeGreaterThan(3);
    expect(s.y).toBeLessThanOrEqual(10);
  });

  it("springs back after overscrolling either edge", () => {
    const top = fresh(-0.5, -3);
    run(top, 2);
    expect(top.y).toBeCloseTo(0, 2);
    const bottom = fresh(10.6, 4);
    run(bottom, 2);
    expect(bottom.y).toBeCloseTo(10, 2);
  });

  it("rubber-bands drags past an edge, never beyond the limit", () => {
    expect(applyRubber(5, { min: 0, max: 10 })).toBe(5);
    expect(applyRubber(-0.3, { min: 0, max: 10 })).toBeGreaterThan(-0.3);
    expect(applyRubber(-100, { min: 0, max: 10 })).toBeGreaterThan(-0.9);
    expect(rubberBand(0)).toBe(0);
  });

  it("tweens to a target and ends exactly on it", () => {
    const s = fresh(0);
    s.tween = { from: 0, to: 4, t: 0, dur: 0.5 };
    run(s, 0.25);
    expect(s.y).toBeGreaterThan(0);
    expect(s.y).toBeLessThan(4);
    run(s, 0.5);
    expect(s.y).toBe(4);
    expect(s.tween).toBeNull();
  });

  it("does not move while dragging", () => {
    const s = fresh(3, 5);
    s.dragging = true;
    run(s, 1);
    expect(s.y).toBe(3);
  });
});

describe("camera framing", () => {
  it("makes the column's outer width overfill the view by COLUMN_OVERFILL on phone screens (no side gaps)", () => {
    for (const aspect of [390 / 844, 390 / 700, 360 / 780]) {
      const viewWidth = 2 * shelfDistance(aspect) * TAN * aspect;
      expect(COLUMN_WIDTH / viewWidth).toBeCloseTo(COLUMN_OVERFILL, 6);
    }
  });

  it("scroll bounds start with the top shelf near the top of the view and never invert", () => {
    const b = shelfScrollBounds(0.5, 0.5);
    expect(b.max).toBeGreaterThanOrEqual(b.min);
    const long = shelfScrollBounds(20, 0.5);
    expect(long.max).toBeGreaterThan(long.min);
    expect(long.min).toBeCloseTo(long.viewHeight / 2 - 0.3, 5);
  });
});
