import { doorAngle, doorSwing, LETTER_CROOKED, letterPose, signAngle } from "../animation";
import { PANTRY_DIMENSIONS } from "../dimensions";
import { listLines, LIST_FALLBACK } from "../list";

describe("pantry exterior animation", () => {
  it("doors map 0 -> closed and 1 -> exactly 110 degrees, with a small overshoot in between", () => {
    expect(doorAngle(0)).toBe(0);
    expect(doorAngle(1)).toBeCloseTo(PANTRY_DIMENSIONS.doorOpenAngle, 6);
    expect(PANTRY_DIMENSIONS.doorOpenAngle).toBeCloseTo((110 * Math.PI) / 180, 6);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => doorSwing(i / 100)));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.06);
    // clamps out-of-range input
    expect(doorSwing(-1)).toBe(0);
    expect(doorSwing(2)).toBeCloseTo(1, 6);
  });

  it("letters shake after opening and settle (and stay) off-centre", () => {
    const settled = letterPose(2, 5, false);
    expect(settled.dy).toBe(0);
    expect(settled.rz).toBeCloseTo(LETTER_CROOKED[2].rz, 6);
    expect(settled.ry).toBeCloseTo(LETTER_CROOKED[2].ry, 6);
    // mid-shake differs from the settled pose
    const mid = letterPose(0, 0.12, false);
    expect(Math.abs(mid.rz - LETTER_CROOKED[0].rz) + mid.dy).toBeGreaterThan(0.02);
    // staggered: the last letter hasn't started when the first one has
    expect(letterPose(5, 0.05, false).rz).toBeCloseTo(0, 9);
    // re-opening starts from the crooked pose, never snapping back to neat
    expect(letterPose(3, -0.1, true).rz).toBeCloseTo(LETTER_CROOKED[3].rz, 6);
  });

  it("EZ sign swings after opening, then settles slightly crooked", () => {
    const now = 100;
    const late = signAngle(now, 20, true, false);
    expect(Math.abs(late)).toBeGreaterThan(0.05);
    expect(Math.abs(signAngle(now, 0.3, true, false) - late)).toBeGreaterThan(0.1);
    // idle sway only before the first opening
    expect(Math.abs(signAngle(now, 0, false, false))).toBeLessThan(0.04);
  });
});

describe("pantry list preview", () => {
  it("shows up to 3 names and falls back to ham/eggs/rice", () => {
    expect(listLines(["milk", " bread ", "", "apples", "eggs"])).toEqual(["milk", "bread", "apples"]);
    expect(listLines([])).toEqual(LIST_FALLBACK);
    expect(listLines(undefined)).toEqual(LIST_FALLBACK);
    expect(listLines(["  "])).toEqual(LIST_FALLBACK);
  });
});
