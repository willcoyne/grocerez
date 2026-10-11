// Per-frame pose logic for the exterior, kept pure (inputs: phase, openProgress, time) so it is testable and can
// drive both the R3F component and a plain three.js preview.
import type { NoteKind, PantryPhase } from "../../types";
import { type ExteriorHandles, NOTE_PIN_Y } from "./builders";
import { LIST_LIFT_START } from "../motion";
import { PANTRY_DIMENSIONS as D } from "./dimensions";
import { getMaterials } from "./materials";

export type ExteriorAnimState = {
  lastPhase: PantryPhase | null;
  /** letters/sign have been knocked crooked at least once (they stay that way) */
  opened: boolean;
  /** clock time the latest `opening` started; -Infinity = already settled */
  openedAt: number;
  /** whether the latest shake started from the crooked pose (re-open) instead of neat */
  shakeFromCrooked: boolean;
  /** door swing state (see stepDoor) */
  door: DoorMotion;
  hover: boolean;
  /** pointer is over the pinned list (web hover) */
  noteHover: boolean;
  /** smoothed 0..1 hover lift of the note */
  noteLift: number;
  /** pointer is over the pinned Me note (web hover) */
  meHover: boolean;
  /** smoothed 0..1 hover lift of the Me note */
  meLift: number;
  /** pointer is over the pinned Week note (web hover) */
  weekHover: boolean;
  /** smoothed 0..1 hover lift of the Week note */
  weekLift: number;
  glow: number;
};

export function createAnimState(): ExteriorAnimState {
  return {
    lastPhase: null,
    opened: false,
    openedAt: -Infinity,
    shakeFromCrooked: false,
    door: createDoorMotion(),
    hover: false,
    noteHover: false,
    noteLift: 0,
    meHover: false,
    meLift: 0,
    weekHover: false,
    weekLift: 0,
    glow: 0,
  };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Door swing curve: an ease-out push (doors are flung open) with a soft ~3% overshoot late in the swing that settles
 * back to exactly 1 at p=1. Monotonic enough to read as one motion; gentle when the foundation already eases p.
 */
export function doorSwing(p: number): number {
  const x = clamp01(p);
  const base = 1 - Math.pow(1 - x, 2.2);
  const bump = 0.07 * Math.sin(Math.PI * smoothstep(0.55, 1, x));
  return base + bump;
}

/** Door swing angle (radians, positive = open) for a given openProgress. */
export function doorAngle(openProgress: number): number {
  return D.doorOpenAngle * doorSwing(openProgress);
}

// ---------------------------------------------------------------------------------------------------------------
// Door motion (opening, closing, reversals, the settle wobble and the "peek" tap hint)
//
// The doors are driven from ONE continuous value, the linear phase clock `open` (0 closed .. 1 open; PantryScreen's
// PhaseDriver), with a separate curve per direction. Opening keeps the flung-open look (doorSwing, overshoot allowed).
// Closing must NOT replay that curve backwards: run in reverse, doorSwing's overshoot first swings the doors further
// OPEN (110° → 114°) before they turn and close, and its steep start becomes a slam at the end. Closing is a plain
// ease-in-out from wherever the doors are to exactly 0: monotonic, soft landing, never past the frame. A change of
// direction mid-way starts the new curve from the angle on screen (both curves begin with zero velocity), so the
// doors never jump. The wobble only runs after a completed opening and the peek only after the doors have rested
// shut for a while, each starting/stopping at zero offset.

/** Largest swing angle the doors ever reach: 110° + the opening overshoot (~3.9%) + the settle wobble (0.03 rad). */
export const DOOR_MAX_ANGLE = D.doorOpenAngle * 1.045 + 0.03;

/**
 * Where props may be mounted on the pantry's front stiles (list note on the right, meal-prep calendar on the left)
 * without the doors ever touching them, for every angle the doors reach (0 .. DOOR_MAX_ANGLE; the doors never swing
 * below 0). World units, right stile; mirror x for the left one. The stile face is z = 0 and spans |x| 0.85 .. 1.10;
 * the hinge line is |x| = 0.88 (front of the closed door z = 0.06, back z = 0.01). Measured from the real door geometry
 * (incl. the mid-rail sill that pokes 0.045 forward and the knobs) by exterior/__tests__/door-motion.test.ts.
 *  - hinge zone |x| < `outboardX`: the closed door covers it from z = 0.01, so a prop must stay behind `hingeZoneMaxZ`;
 *  - |x| ≥ `outboardX`: stays clear if its front is behind `outboardMaxZ`, except in the mid-rail sill's height band
 *    (`sill.minY` .. `sill.maxY`), where the sill passes just outboard of the hinge at full open: behind `sill.maxZ`;
 *  - outside the door's height band (`doorMinY` .. `doorMaxY`) there is no constraint.
 */
export const STILE_CLEARANCE = {
  outboardX: 0.9,
  hingeZoneMaxZ: 0.008,
  outboardMaxZ: 0.12,
  sill: { minY: 1.09, maxY: 1.15, maxZ: 0.045 },
  doorMinY: D.door.bottomY,
  doorMaxY: D.door.bottomY + D.door.height,
} as const;

/** Inverse of easeInOutCubic (0..1 → 0..1), to recover the linear clock from an eased `openProgress`. */
export function uneaseInOutCubic(p: number): number {
  const v = clamp01(p);
  return v < 0.5 ? Math.cbrt(v / 4) : 1 - Math.cbrt(2 * (1 - v)) / 2;
}

/** No peek for this long after the doors come to rest shut (the landing must read as final). */
export const PEEK_SETTLE = 1.5;
/** Peek cycle: every PEEK_PERIOD s the doors open a hair for the last PEEK_LEN s of the cycle. */
const PEEK_PERIOD = 4.5;
const PEEK_LEN = 0.7;
const PEEK_AMP = 0.04;

/** "Tap me" peek offset (radians) `restTime` s after the doors came to rest shut; 0 during the settle period. */
export function peekOffset(restTime: number): number {
  if (!(restTime >= PEEK_SETTLE)) return 0;
  const local = (restTime - PEEK_SETTLE) % PEEK_PERIOD;
  const start = PEEK_PERIOD - PEEK_LEN;
  if (local <= start) return 0;
  return PEEK_AMP * Math.pow(Math.sin(((local - start) / PEEK_LEN) * Math.PI), 2);
}

/** The settle wobble is exactly over after this long (faded out, so it is never still running when a close starts). */
export const WOBBLE_LEN = 1.2;

/** Small damped wobble (radians) `t` s after the doors reached fully open; starts at 0 and is exactly 0 from WOBBLE_LEN. */
export function doorWobble(t: number): number {
  if (!(t > 0) || t >= WOBBLE_LEN) return 0;
  return 0.03 * Math.exp(-5 * t) * Math.sin(16 * t) * (1 - smoothstep(0.7 * WOBBLE_LEN, WOBBLE_LEN, t));
}

export type DoorMotion = {
  /** direction of the current swing */
  mode: "open" | "close";
  /** angle on screen when the current swing started, and the linear clock value then */
  from: number;
  q0: number;
  /** last linear clock value seen (null until the first frame) */
  lastQ: number | null;
  /** angle applied last frame (radians, incl. wobble/peek) */
  angle: number;
  /** clock time the doors reached fully open (wobble), or null */
  fullAt: number | null;
  /** clock time the doors came to rest shut in `closed` (peek), or null */
  restAt: number | null;
  /** smoothed peek offset, so cancelling a peek (tap, list) eases out instead of snapping shut */
  peek: number;
};

export function createDoorMotion(): DoorMotion {
  return { mode: "open", from: 0, q0: 0, lastQ: null, angle: 0, fullAt: null, restAt: null, peek: 0 };
}

const Q_EPS = 1e-6;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Advance the doors one frame. `q` is the LINEAR open clock (0..1), `now` a monotonic clock (s), `dt` the frame time.
 * Returns the swing angle (radians, positive = open) and remembers it in `m.angle`.
 */
export function stepDoor(m: DoorMotion, phase: PantryPhase, q: number, now: number, dt: number): number {
  const open = D.doorOpenAngle;
  q = clamp01(q);
  if (m.lastQ === null) m.lastQ = q;
  const dir = q > m.lastQ + Q_EPS ? "open" : q < m.lastQ - Q_EPS ? "close" : null;
  if (dir && (dir !== m.mode || m.peek > 0)) {
    // reverse (or leaving a peek): the new curve starts from what is on screen (wobble/peek folded in), from where
    // the clock is now
    m.mode = dir;
    m.from = m.angle;
    m.q0 = m.lastQ;
    m.peek = 0;
    m.fullAt = null;
  }
  m.lastQ = q;

  let angle: number;
  if (m.mode === "open") {
    // from the closed rest this is exactly the original opening: doorAngle(easeInOutCubic(q))
    const span = 1 - m.q0;
    const u = span > Q_EPS ? clamp01((q - m.q0) / span) : 1;
    angle = m.from + (open - m.from) * doorSwing(easeInOut(u));
    if (q >= 1) {
      if (m.fullAt === null) m.fullAt = now;
      angle += doorWobble(now - m.fullAt);
    }
  } else {
    // monotonic ease-in-out down to exactly 0 (no overshoot, so never through the frame / into the stiles)
    angle = m.q0 > Q_EPS ? Math.max(0, m.from) * easeInOut(q / m.q0) : 0;
  }

  // peek: only once the doors have rested shut in `closed` for PEEK_SETTLE; eases out when cancelled
  const atRest = phase === "closed" && q <= 0 && angle <= 1e-9;
  if (atRest) {
    if (m.restAt === null) m.restAt = now;
  } else {
    m.restAt = null;
  }
  const target = atRest && m.restAt !== null ? peekOffset(now - m.restAt) : 0;
  m.peek = atRest ? target : m.peek * Math.exp(-Math.max(0, dt) * 14);
  if (m.peek < 1e-5) m.peek = 0;
  angle += m.peek;

  m.angle = angle;
  return angle;
}

/** Where each "Grocer" letter settles after the jolt: x offset, y-rotation, z-tilt. Leans chosen so neighbours don't collide. */
export const LETTER_CROOKED: readonly { dx: number; ry: number; rz: number }[] = [
  { dx: -0.03, ry: 0.14, rz: 0.1 },
  { dx: -0.01, ry: -0.1, rz: 0.05 },
  { dx: 0.0, ry: 0.18, rz: -0.06 },
  { dx: 0.015, ry: -0.12, rz: -0.11 },
  { dx: 0.045, ry: 0.08, rz: -0.03 },
  { dx: 0.035, ry: -0.22, rz: -0.15 },
];

export type LetterPose = { dx: number; dy: number; ry: number; rz: number };

const LETTER_STAGGER = 0.07;
const SHAKE_LEN = 0.9;

/** Pose of letter i at `t` seconds after the opening began (t<0 = before it reaches this letter). */
export function letterPose(i: number, t: number, fromCrooked: boolean): LetterPose {
  const fin = LETTER_CROOKED[i % LETTER_CROOKED.length];
  const tau = t - i * LETTER_STAGGER;
  const w = fromCrooked ? 1 : smoothstep(0.05, 0.6, tau);
  const pose: LetterPose = { dx: fin.dx * w, dy: 0, ry: fin.ry * w, rz: fin.rz * w };
  if (tau >= 0 && tau < SHAKE_LEN) {
    const env = Math.exp(-5.5 * tau);
    pose.dy += 0.11 * env * Math.abs(Math.sin(13 * tau));
    pose.rz += 0.32 * env * Math.sin(21 * tau + i * 1.3);
    pose.ry += 0.15 * env * Math.sin(17 * tau + i * 0.7);
    pose.dx += 0.02 * env * Math.sin(19 * tau + i);
  }
  return pose;
}

const SIGN_CROOKED = -0.09;

/** EZ sign angle about its nail: idle sway + damped pendulum after opening, settling crooked. */
export function signAngle(now: number, sinceOpen: number, opened: boolean, fromCrooked: boolean): number {
  const idle = 0.022 * Math.sin(now * 1.3) + 0.008 * Math.sin(now * 2.9 + 1);
  if (!opened) return idle;
  const tau = sinceOpen;
  const crook = fromCrooked ? SIGN_CROOKED : SIGN_CROOKED * smoothstep(0, 2.2, tau);
  const swing = tau >= 0 && Number.isFinite(tau) ? 0.5 * Math.exp(-1.5 * tau) * Math.sin((Math.PI * 2 * tau) / 1.15) : 0;
  return crook + swing + idle * 0.6;
}

/** How far the paper travels toward the camera at full lift (world units). */
const NOTE_LIFT_Z = 0.3;

/** Paper lift (0 pinned .. 1 right in front of the camera) for a `list` clock value. */
export function noteLiftFor(listProgress: number): number {
  return smoothstep(LIST_LIFT_START, 1, listProgress);
}

export type NotePose = { x: number; y: number; z: number; rx: number; rz: number };

/**
 * Pose of the paper relative to its pinned spot. Idle in `closed`: every ~5 s a tiny flutter about the pin ("tap me");
 * hovered: lifted a hair and swaying; lifting (`list`): pops off the pin, untilts and glides toward the camera.
 */
export function notePose(now: number, hover: number, lift: number, tappable: boolean, baseRotZ: number): NotePose {
  let a = 0; // swing about the pin
  if (tappable) {
    const local = now % 5.2;
    if (local > 4.4) {
      const u = (local - 4.4) / 0.8;
      a += 0.07 * Math.sin(u * Math.PI * 3) * Math.sin(u * Math.PI);
    }
    a += hover * 0.045 * Math.sin(now * 6.5);
  }
  a *= 1 - lift;
  const P = NOTE_PIN_Y;
  return {
    x: P * Math.sin(a),
    y: P * (1 - Math.cos(a)) + 0.05 * Math.sin(Math.PI * Math.min(1, lift * 1.6)) + 0.02 * lift,
    z: hover * 0.025 * (1 - lift) + NOTE_LIFT_Z * lift,
    rx: -0.25 * Math.sin(Math.PI * lift),
    // untilt so the paper faces the camera squarely by the time the overlay takes over
    rz: a - baseRotZ * lift,
  };
}

export type ExteriorInput = {
  phase: PantryPhase;
  /** eased door progress (easeInOutCubic of the linear clock) */
  openProgress: number;
  listProgress?: number;
  /** live LINEAR door clock read this frame (preferred: no React lag or quantisation); see PantryExteriorProps.clock */
  openClock?: number;
  /** which pinned paper the `list` phase lifts toward the camera (default the List) */
  liftedNote?: NoteKind;
};

/** Apply poses to the scene graph. `now` is a monotonically increasing clock in seconds. */
export function updateExterior(h: ExteriorHandles, s: ExteriorAnimState, input: ExteriorInput, now: number, dt: number) {
  const { phase } = input;
  const p = clamp01(input.openProgress);

  if (phase !== s.lastPhase) {
    if (phase === "opening") {
      s.shakeFromCrooked = s.opened;
      s.opened = true;
      s.openedAt = now;
    } else if (!s.opened && (phase === "zooming" || phase === "shelves" || phase === "closing")) {
      // mounted mid-flow (e.g. deep link back to shelves): just be settled crooked
      s.opened = true;
      s.openedAt = -Infinity;
      s.shakeFromCrooked = true;
    }
    s.lastPhase = phase;
  }

  // --- doors (linear clock: live when given, else recovered from the eased openProgress)
  const q = input.openClock !== undefined ? clamp01(input.openClock) : uneaseInOutCubic(p);
  const angle = stepDoor(s.door, phase, q, now, dt);
  h.leftDoor.rotation.y = -angle;
  h.rightDoor.rotation.y = angle;

  // --- letters
  const since = now - s.openedAt;
  for (let i = 0; i < h.letters.length; i++) {
    const L = h.letters[i];
    const pose: LetterPose = s.opened ? letterPose(i, since, s.shakeFromCrooked) : { dx: 0, dy: 0, ry: 0, rz: 0 };
    // lift so a tilted letter pivots on its corner instead of sinking into the crown
    const lift = Math.abs(Math.sin(pose.rz)) * L.halfW * 0.85;
    L.mesh.position.set(L.x + pose.dx, D.crownTop + pose.dy + lift, h.lettersZ);
    L.mesh.rotation.set(0, pose.ry, pose.rz);
  }

  // --- sign
  h.sign.rotation.z = signAngle(now, since, s.opened, s.shakeFromCrooked);

  // --- pinned papers (List, Me, Week): "tap me" flutter (out of step) / hover lift / lift-off toward the camera
  const closed = phase === "closed";
  const lifted = input.liftedNote ?? "list";
  const lift = noteLiftFor(input.listProgress ?? 0);
  const k = Math.min(1, dt * 10);
  s.noteLift += ((s.noteHover && closed ? 1 : 0) - s.noteLift) * k;
  s.meLift += ((s.meHover && closed ? 1 : 0) - s.meLift) * k;
  s.weekLift += ((s.weekHover && closed ? 1 : 0) - s.weekLift) * k;
  const papers = [
    { paper: h.notePaper, kind: "list", hover: s.noteLift, phase: 0, rotZ: D.note.rotZ },
    { paper: h.mePaper, kind: "me", hover: s.meLift, phase: 1.3, rotZ: D.meNote.rotZ },
    { paper: h.weekPaper, kind: "week", hover: s.weekLift, phase: 2.6, rotZ: D.weekNote.rotZ },
  ] as const;
  for (const n of papers) {
    const pose = notePose(now + n.phase, n.hover, n.kind === lifted ? lift : 0, closed, n.rotZ);
    n.paper.position.set(pose.x, pose.y, pose.z);
    n.paper.rotation.set(pose.rx, 0, pose.rz);
  }

  // --- knob breathing glow (closed only) to invite a tap
  const target =
    phase === "closed" ? 0.16 + 0.3 * (0.5 + 0.5 * Math.sin(now * 2.6)) + (s.hover && !s.noteHover && !s.meHover && !s.weekHover ? 0.35 : 0) : 0;
  s.glow += (target - s.glow) * Math.min(1, dt * 6);
  getMaterials().knob.emissiveIntensity = s.glow;
}
