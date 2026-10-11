import { LIST_CAMERA_END, LIST_LIFT_START, NOTE_FILL, noteDistance, TAN } from "../../motion";
import { noteLiftFor, notePose } from "../animation";
import { NOTE_HIT, HIT_BOX } from "../builders";
import { PANTRY_DIMENSIONS } from "../dimensions";

const N = PANTRY_DIMENSIONS.note;

describe("pinned list note", () => {
  it("its hit box covers the paper and sits in front of the pantry's hit box (so a tap never opens the doors)", () => {
    const [x, y, z] = NOTE_HIT.position;
    const [w, h, d] = NOTE_HIT.size;
    expect(x - w / 2).toBeLessThan(N.x - N.width / 2);
    expect(x + w / 2).toBeGreaterThan(N.x + N.width / 2);
    expect(y - h / 2).toBeLessThan(N.y - N.height / 2);
    expect(y + h / 2).toBeGreaterThan(N.y + N.height / 2);
    expect(z - d / 2).toBeLessThanOrEqual(N.z);
    // pantry hit box is 1.5 deep
    expect(z + d / 2).toBeGreaterThan(HIT_BOX.position[2] + 0.75);
  });

  it("the camera frames the note at ~70% of the screen width", () => {
    for (const aspect of [9 / 19.5, 9 / 16, 3 / 4]) {
      const dist = noteDistance(N.width, N.height, aspect);
      const viewW = 2 * dist * TAN * aspect;
      const viewH = 2 * dist * TAN;
      expect(N.width / viewW).toBeLessThanOrEqual(NOTE_FILL + 1e-9);
      expect(N.height / viewH).toBeLessThanOrEqual(0.8 + 1e-9);
      // portrait phones: width-bound, i.e. exactly 70%
      if (aspect < 0.6) expect(N.width / viewW).toBeCloseTo(NOTE_FILL, 6);
    }
  });

  it("the paper waits for the camera, then lifts off toward it and untilts", () => {
    expect(LIST_LIFT_START).toBeLessThan(LIST_CAMERA_END);
    expect(noteLiftFor(0)).toBe(0);
    expect(noteLiftFor(LIST_LIFT_START)).toBe(0);
    expect(noteLiftFor(1)).toBe(1);
    const pinned = notePose(0.5, 0, 0, false, N.rotZ);
    expect(pinned).toEqual({ x: 0, y: 0, z: 0, rx: -0, rz: 0 });
    const lifted = notePose(0.5, 0, 1, false, N.rotZ);
    expect(lifted.z).toBeGreaterThan(0.2);
    expect(lifted.rz + N.rotZ).toBeCloseTo(0, 6); // faces the camera square
  });

  it("hover lifts the paper a hair and the idle flutter stays small", () => {
    expect(notePose(1, 1, 0, true, N.rotZ).z).toBeGreaterThan(0);
    for (let t = 0; t < 10.4; t += 0.05) expect(Math.abs(notePose(t, 0, 0, true, N.rotZ).rz)).toBeLessThan(0.08);
  });
});
