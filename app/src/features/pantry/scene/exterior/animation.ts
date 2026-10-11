// Per-frame pose logic for the exterior, kept pure (inputs: phase, openProgress, time) so it is testable and can
// drive both the R3F component and a plain three.js preview.
import type { PantryPhase } from "../../types";
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
  /** clock time the doors reached fully open (for the little wobble) */
  doorFullAt: number | null;
  hover: boolean;
  /** pointer is over the pinned list (web hover) */
  noteHover: boolean;
  /** smoothed 0..1 hover lift of the note */
  noteLift: number;
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
    doorFullAt: null,
    hover: false,
    noteHover: false,
    noteLift: 0,
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

export type ExteriorInput = { phase: PantryPhase; openProgress: number; listProgress?: number };

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

  // --- doors
  let angle = doorAngle(p);
  if (p >= 0.999) {
    if (s.doorFullAt === null) s.doorFullAt = now;
    const tau = now - s.doorFullAt;
    angle += 0.03 * Math.exp(-5 * tau) * Math.sin(16 * tau);
  } else if (p < 0.98) {
    s.doorFullAt = null;
  }
  if (phase === "closed" && p <= 0.001) {
    // every few seconds the doors "peek" open a hair, inviting a tap
    const local = now % 4.5;
    if (local > 3.8) angle += 0.04 * Math.pow(Math.sin(((local - 3.8) / 0.7) * Math.PI), 2);
  }
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

  // --- pinned list: "tap me" flutter / hover lift / lift-off toward the camera
  s.noteLift += ((s.noteHover && phase === "closed" ? 1 : 0) - s.noteLift) * Math.min(1, dt * 10);
  const np = notePose(now, s.noteLift, noteLiftFor(input.listProgress ?? 0), phase === "closed", D.note.rotZ);
  h.notePaper.position.set(np.x, np.y, np.z);
  h.notePaper.rotation.set(np.rx, 0, np.rz);

  // --- pinned Week note: the same flutter/hover, out of step with the list; it never lifts off (the sheet opens)
  s.weekLift += ((s.weekHover && phase === "closed" ? 1 : 0) - s.weekLift) * Math.min(1, dt * 10);
  const wp = notePose(now + 2.6, s.weekLift, 0, phase === "closed", D.weekNote.rotZ);
  h.weekPaper.position.set(wp.x, wp.y, wp.z);
  h.weekPaper.rotation.set(wp.rx, 0, wp.rz);

  // --- knob breathing glow (closed only) to invite a tap
  const target =
    phase === "closed" ? 0.16 + 0.3 * (0.5 + 0.5 * Math.sin(now * 2.6)) + (s.hover && !s.noteHover && !s.weekHover ? 0.35 : 0) : 0;
  s.glow += (target - s.glow) * Math.min(1, dt * 6);
  getMaterials().knob.emissiveIntensity = s.glow;
}
