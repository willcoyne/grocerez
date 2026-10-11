// Regression tests for the "weird glitch when the shutters close" (door motion over time, frame by frame).
// The frame driver below mirrors PantryScreen's PhaseDriver: the linear clock `open` rises over `open` s, holds at 1
// through zooming/shelves, then in `closing` waits `doorDelay` s and falls to 0 over `doorClose` s.
import { Matrix4, Vector3 } from "three";

import type { PantryPhase } from "../../../types";
import { easeInOutCubic } from "../../motion";
import {
  createAnimState,
  createDoorMotion,
  doorAngle,
  DOOR_MAX_ANGLE,
  doorWobble,
  type DoorMotion,
  PEEK_SETTLE,
  peekOffset,
  STILE_CLEARANCE,
  stepDoor,
  uneaseInOutCubic,
  updateExterior,
  WOBBLE_LEN,
} from "../animation";
import { type ExteriorHandles, getSharedGeometry, KNOB_LOCAL } from "../builders";
import { PANTRY_DIMENSIONS as D } from "../dimensions";

const OPEN = D.doorOpenAngle;
const DEG = Math.PI / 180;
const NORMAL = { open: 1.6, zoom: 1.2, doorDelay: 0.35, doorClose: 1.1 };
const REDUCED = { open: 0.3, zoom: 0, doorDelay: 0, doorClose: 0.3 };

type Frame = { phase: PantryPhase; q: number; t: number; angle: number };

/** Runs a list of (phase, q) frames through one DoorMotion with a fixed dt, starting at clock `t0`. */
class Rig {
  m: DoorMotion = createDoorMotion();
  t: number;
  frames: Frame[] = [];
  constructor(
    readonly dt: number,
    t0 = 100,
  ) {
    this.t = t0;
  }
  step(phase: PantryPhase, q: number) {
    this.t += this.dt;
    const angle = stepDoor(this.m, phase, q, this.t, this.dt);
    this.frames.push({ phase, q, t: this.t, angle });
    return angle;
  }
  hold(phase: PantryPhase, q: number, seconds: number) {
    for (let e = 0; e < seconds - 1e-9; e += this.dt) this.step(phase, q);
  }
  /** opening → zooming → shelves (doors fully open, wobble done) */
  open(d = NORMAL, shelvesFor = 1.5) {
    let q = 0;
    while (q < 1) {
      q = d.open > 0 ? Math.min(1, q + this.dt / d.open) : 1;
      this.step("opening", q);
    }
    this.hold("zooming", 1, d.zoom);
    this.hold("shelves", 1, shelvesFor);
  }
  /** closing until the clock reaches 0; returns the index of the first closing frame */
  close(d = NORMAL, from = 1) {
    const first = this.frames.length;
    let e = 0;
    let q = from;
    while (q > 0) {
      e += Math.min(this.dt, 0.1);
      q = d.doorClose > 0 ? Math.min(from, 1 - Math.min(1, Math.max(0, (e - d.doorDelay) / d.doorClose))) : 0;
      this.step("closing", q);
    }
    return first;
  }
}

const deltas = (fs: Frame[]) => fs.slice(1).map((f, i) => f.angle - fs[i].angle);
const maxAbs = (xs: number[]) => xs.reduce((a, x) => Math.max(a, Math.abs(x)), 0);

describe("door motion: closing", () => {
  it.each([1 / 120, 1 / 60, 1 / 30, 0.1])("a close after a full open is monotonic, soft and ends exactly shut (dt=%f)", (dt) => {
    const r = new Rig(dt);
    r.open();
    const i0 = r.close();
    const closing = r.frames.slice(i0 - 1);
    const d = deltas(closing);
    // never moves AWAY from closed (the old curve swung out to ~114° first), never past the frame, never above open
    expect(Math.max(...d)).toBeLessThanOrEqual(1e-12);
    expect(Math.max(...closing.map((f) => f.angle))).toBeLessThanOrEqual(OPEN + 1e-9);
    expect(Math.min(...closing.map((f) => f.angle))).toBeGreaterThanOrEqual(0);
    // bounded per-frame step: easeInOutCubic's peak slope is 3
    expect(maxAbs(d)).toBeLessThanOrEqual((3 * OPEN * Math.min(dt, 0.1)) / NORMAL.doorClose + 1e-9);
    // lands exactly closed, with a soft landing (last step small compared to the mid-swing steps)
    expect(closing[closing.length - 1].angle).toBe(0);
    if (dt <= 1 / 30) expect(Math.abs(d[d.length - 1])).toBeLessThan(maxAbs(d) * 0.1);
  });

  it("reduced motion closes monotonically and exactly", () => {
    const r = new Rig(1 / 60);
    r.open(REDUCED);
    const i0 = r.close(REDUCED);
    const d = deltas(r.frames.slice(i0 - 1));
    expect(Math.max(...d)).toBeLessThanOrEqual(1e-12);
    expect(r.frames[r.frames.length - 1].angle).toBe(0);
  });

  it("the doors never swing past DOOR_MAX_ANGLE (used for the stile clearance)", () => {
    const r = new Rig(1 / 240);
    r.open(NORMAL, 0);
    r.close();
    expect(Math.max(...r.frames.map((f) => f.angle))).toBeLessThanOrEqual(DOOR_MAX_ANGLE);
  });
});

describe("door motion: opening keeps its look", () => {
  it("from rest the opening is exactly doorAngle(easeInOutCubic(q)), overshoot included", () => {
    const r = new Rig(1 / 60);
    r.open();
    const opening = r.frames.filter((x) => x.phase === "opening" && x.q < 1);
    expect(Math.max(...opening.map((f) => Math.abs(f.angle - doorAngle(easeInOutCubic(f.q)))))).toBeLessThan(1e-12);
    expect(Math.max(...r.frames.map((f) => f.angle))).toBeGreaterThan(OPEN * 1.02);
  });

  it("the settle wobble starts at 0 and is exactly over after WOBBLE_LEN", () => {
    expect(doorWobble(0)).toBe(0);
    expect(doorWobble(WOBBLE_LEN)).toBe(0);
    expect(doorWobble(WOBBLE_LEN + 3)).toBe(0);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => Math.abs(doorWobble(i / 100))))).toBeGreaterThan(0.01);
    const r = new Rig(1 / 60);
    r.open(NORMAL, 0.2);
    // shelves reached after zooming (1.2 s) = WOBBLE_LEN: the doors sit exactly at 110° before any close can start
    expect(r.frames[r.frames.length - 1].angle).toBe(OPEN);
  });
});

describe("door motion: reversals hand off without a jump", () => {
  const dt = 1 / 60;
  // no frame of a reversal may move more than the fastest frame of an uninterrupted open + close
  const baseline = (() => {
    const r = new Rig(dt);
    r.open();
    r.close();
    return maxAbs(deltas(r.frames));
  })();
  const bound = baseline * 1.01;

  it("reverse mid-open: continuous, then a monotonic close to exactly 0", () => {
    const r = new Rig(dt);
    let q = 0;
    while (q < 0.5) r.step("opening", (q = Math.min(0.5, q + dt / NORMAL.open)));
    const turn = r.frames.length;
    while (q > 0) r.step("closing", (q = Math.max(0, q - dt / NORMAL.doorClose)));
    // opening leg: never faster than a normal swing; closing leg: the ease-in-out over the clock that is left
    expect(maxAbs(deltas(r.frames.slice(0, turn)))).toBeLessThan(bound);
    const from = r.frames[turn - 1].angle;
    expect(maxAbs(deltas(r.frames.slice(turn - 1)))).toBeLessThanOrEqual((3 * from * dt) / (0.5 * NORMAL.doorClose) + 1e-9);
    expect(Math.max(...deltas(r.frames.slice(turn - 1)))).toBeLessThanOrEqual(1e-12);
    // the first closing frame barely moves (eased start from the angle on screen)
    expect(Math.abs(r.frames[turn].angle - r.frames[turn - 1].angle)).toBeLessThan(0.002);
    expect(r.frames[r.frames.length - 1].angle).toBe(0);
  });

  it("reverse mid-close: continuous, re-opens from the current angle and ends exactly open", () => {
    const r = new Rig(dt);
    r.open();
    let q = 1;
    while (q > 0.4) r.step("closing", (q = Math.max(0.4, q - dt / NORMAL.doorClose)));
    const turn = r.frames.length;
    while (q < 1) r.step("opening", (q = Math.min(1, q + dt / NORMAL.open)));
    r.hold("zooming", 1, NORMAL.zoom);
    expect(maxAbs(deltas(r.frames))).toBeLessThan(bound);
    expect(Math.abs(r.frames[turn].angle - r.frames[turn - 1].angle)).toBeLessThan(0.002);
    expect(r.frames[r.frames.length - 1].angle).toBe(OPEN);
  });

  it("reverse right at full open (wobble running) and rapid open → close → open never jump", () => {
    const r = new Rig(dt);
    let q = 0;
    while (q < 1) r.step("opening", (q = Math.min(1, q + dt / NORMAL.open)));
    r.hold("opening", 1, 0.1); // wobble running
    expect(Math.abs(r.frames[r.frames.length - 1].angle - OPEN)).toBeGreaterThan(1e-4);
    r.close(NORMAL);
    r.hold("closed", 0, 0.05);
    q = 0;
    while (q < 1) r.step("opening", (q = Math.min(1, q + dt / NORMAL.open)));
    expect(maxAbs(deltas(r.frames))).toBeLessThan(bound);
    expect(Math.min(...r.frames.map((f) => f.angle))).toBeGreaterThanOrEqual(0);
  });
});

describe("door motion: the peek hint", () => {
  it("is off during the close and for PEEK_SETTLE after landing, whatever the clock (no snap open on landing)", () => {
    // the old peek ran off the global clock: landing inside its window popped the doors 2.3° open in one frame
    for (let t0 = 0; t0 < 4.5; t0 += 0.15) {
      const r = new Rig(1 / 60, 100 + t0);
      r.open();
      const i0 = r.close();
      const landed = r.frames.length;
      r.hold("closed", 0, PEEK_SETTLE - 0.02);
      expect(Math.max(...r.frames.slice(i0).map((f) => f.angle))).toBeLessThanOrEqual(r.frames[i0 - 1].angle);
      expect(Math.max(...r.frames.slice(landed).map((f) => f.angle))).toBe(0);
    }
  });

  it("comes back later, smoothly, and eases out when cancelled (list) instead of snapping shut", () => {
    const dt = 1 / 60;
    const r = new Rig(dt);
    r.hold("closed", 0, PEEK_SETTLE + 4.5);
    const peaks = r.frames.map((f) => f.angle);
    expect(Math.max(...peaks)).toBeGreaterThan(0.03);
    expect(maxAbs(deltas(r.frames))).toBeLessThan(0.04 * Math.PI * 2 * (dt / 0.7));
    // cancel mid-peek
    const r2 = new Rig(dt);
    r2.hold("closed", 0, PEEK_SETTLE + 4.5 - 0.35); // middle of the first peek
    expect(r2.frames[r2.frames.length - 1].angle).toBeGreaterThan(0.03);
    const i = r2.frames.length;
    r2.hold("list", 0, 1);
    expect(maxAbs(deltas(r2.frames.slice(i - 1)))).toBeLessThan(0.01);
    expect(r2.frames[r2.frames.length - 1].angle).toBe(0);
  });

  it("opening from mid-peek continues from the peeked angle (no snap back first)", () => {
    const dt = 1 / 60;
    const r = new Rig(dt);
    r.hold("closed", 0, PEEK_SETTLE + 4.5 - 0.35);
    const i = r.frames.length;
    let q = 0;
    while (q < 1) r.step("opening", (q = Math.min(1, q + dt / NORMAL.open)));
    const d = deltas(r.frames.slice(i - 1));
    expect(Math.min(...d.slice(0, 10))).toBeGreaterThanOrEqual(-1e-12);
    expect(r.frames[r.frames.length - 1].angle).toBe(OPEN);
  });

  it("peekOffset is 0 during the settle period and continuous at every window edge", () => {
    expect(peekOffset(0)).toBe(0);
    expect(peekOffset(PEEK_SETTLE - 1e-6)).toBe(0);
    expect(peekOffset(PEEK_SETTLE)).toBe(0);
    let worst = 0;
    for (let t = 0; t < 20; t += 0.001) worst = Math.max(worst, Math.abs(peekOffset(t + 0.001) - peekOffset(t)));
    expect(worst).toBeLessThan(0.0006);
  });
});

describe("door motion through updateExterior", () => {
  const handles = () => {
    const obj = () => ({ rotation: { y: 0, z: 0, set() {} }, position: { set() {} } });
    return {
      root: obj(),
      leftDoor: obj(),
      rightDoor: obj(),
      letters: [],
      lettersZ: 0,
      sign: obj(),
      notePaper: obj(),
      setListLines() {},
      dispose() {},
    } as unknown as ExteriorHandles;
  };

  it("the eased, re-render-quantised openProgress path (no live clock) still closes monotonically to 0", () => {
    const h = handles();
    const s = createAnimState();
    const dt = 1 / 60;
    let t = 50;
    let last = 0;
    const frame = (phase: PantryPhase, q: number) => {
      // ExteriorMount publishes easeInOutCubic(clock.open) only when it moved > 0.004 (or hit 0 / 1)
      const v = easeInOutCubic(q);
      if (v !== last && (Math.abs(v - last) > 0.004 || v === 0 || v === 1)) last = v;
      t += dt;
      updateExterior(h, s, { phase, openProgress: last }, t, dt);
      return -h.leftDoor.rotation.y;
    };
    let q = 0;
    while (q < 1) frame("opening", (q = Math.min(1, q + dt / NORMAL.open)));
    for (let e = 0; e < 2.5; e += dt) frame("shelves", 1);
    const angles: number[] = [];
    let e = 0;
    while (q > 0) {
      e += dt;
      q = 1 - Math.min(1, Math.max(0, (e - 0.35) / 1.1));
      angles.push(frame("closing", q));
    }
    for (let k = 0; k < 30; k++) angles.push(frame("closed", 0));
    expect(Math.max(...angles.slice(1).map((a, k) => a - angles[k]))).toBeLessThanOrEqual(1e-12);
    expect(angles[angles.length - 1]).toBe(0);
    expect(h.rightDoor.rotation.y).toBe(-h.leftDoor.rotation.y);
  });

  it("uneaseInOutCubic inverts the ease", () => {
    let worst = 0;
    for (let x = 0; x <= 1; x += 0.01) worst = Math.max(worst, Math.abs(uneaseInOutCubic(easeInOutCubic(x)) - x));
    expect(worst).toBeLessThan(1e-9);
  });
});

describe("stile clearance (list note on the right stile, meal-prep calendar on the left)", () => {
  it("no door vertex enters STILE_CLEARANCE at any angle the doors reach", () => {
    const g = getSharedGeometry();
    const local: Vector3[] = [];
    const add = (geo: typeof g.door, off: readonly number[]) => {
      const p = geo.getAttribute("position");
      for (let i = 0; i < p.count; i++) local.push(new Vector3(p.getX(i) + off[0], p.getY(i) + off[1], p.getZ(i) + off[2]));
    };
    add(g.door, [0, 0, 0]);
    add(g.knob, KNOB_LOCAL);
    const { hingeX, hingeZ, bottomY } = D.door;
    const C = STILE_CLEARANCE;
    const w = new Vector3();
    let minHinge = Infinity;
    let minOutboard = Infinity;
    let minSill = Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let a = 0; a <= DOOR_MAX_ANGLE + 1e-9; a += 0.25 * DEG) {
      for (const side of [-1, 1] as const) {
        // same transform as builders.createExterior + updateExterior: pivot at the hinge, right door mirrored
        const m = new Matrix4()
          .makeTranslation(side * hingeX, bottomY, hingeZ)
          .multiply(new Matrix4().makeRotationY(side * a))
          .multiply(new Matrix4().makeScale(side === 1 ? -1 : 1, 1, 1));
        for (const p of local) {
          w.copy(p).applyMatrix4(m);
          const ax = Math.abs(w.x);
          if (ax <= D.opening.maxX) continue; // over the opening, not the stile
          if (ax < C.outboardX) minHinge = Math.min(minHinge, w.z);
          else if (w.y >= C.sill.minY && w.y <= C.sill.maxY) minSill = Math.min(minSill, w.z);
          else minOutboard = Math.min(minOutboard, w.z);
          yMin = Math.min(yMin, w.y);
          yMax = Math.max(yMax, w.y);
        }
      }
    }
    expect(minHinge).toBeGreaterThan(C.hingeZoneMaxZ);
    expect(minOutboard).toBeGreaterThan(C.outboardMaxZ);
    expect(minSill).toBeGreaterThan(C.sill.maxZ);
    expect(yMin).toBeGreaterThanOrEqual(C.doorMinY - 1e-6);
    expect(yMax).toBeLessThanOrEqual(C.doorMaxY + 1e-6);
  });

  it("the pinned list (pin, curled paper, hover lift) sits inside the envelope", () => {
    const N = D.note;
    const C = STILE_CLEARANCE;
    // pin head front: note z + 0.046; paper: curl up to +0.039 plus the hover lift (+0.025) in `closed`
    expect(N.z + 0.046).toBeLessThan(C.outboardMaxZ);
    expect(N.z + 0.039 + 0.025).toBeLessThan(C.outboardMaxZ);
    // nowhere near the sill band
    expect(N.y - N.height / 2).toBeGreaterThan(C.sill.maxY);
  });
});
