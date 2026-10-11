/* eslint-disable react-hooks/immutability -- the rig mutates the three.js camera and shared scroll refs in useFrame by design */
/**
 * Camera rig. Owns the scene camera every frame:
 * - closed / opening: frames the whole closed pantry (letters, EZ sign, stool) — fit-width on portrait screens.
 * - zooming: eased dolly from the closed framing through the doorway (`clock.zoom` 0..1).
 * - shelves: follows the shelf scroll (`scroll.state.y`, advanced here via `scroll.step`) and eases to a searched
 *   item (`focus`), with critically-damped smoothing so phase changes never pop.
 * - closing: pulls back from wherever the camera was to the closed framing (`clock.zoom` 1..0).
 * - list: flies from the closed framing to a pinned paper (`noteTarget`: List, Me or Week) so it fills ~70% of the width
 *   (`clock.list` 0..LIST_CAMERA_END; the paper then lifts toward the lens, see exterior/animation.ts) and back.
 * It also keeps the scroll bounds / px-to-world factor in sync with the viewport.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";

import type { NoteKind, PantryPhase } from "../types";
import { PANTRY_DIMENSIONS } from "./exterior/dimensions";
import {
  easeInOutCubic,
  fitDistance,
  FOCUS_ZOOM,
  LIST_CAMERA_END,
  noteDistance,
  shelfDistance,
  shelfScrollBounds,
  TAN,
  type CameraFocus,
  type PhaseClock,
  type Vec3,
} from "./motion";
import type { ShelfScroll } from "./useShelfScroll";

export type { CameraFocus, PhaseClock, Vec3 } from "./motion";

/** Opening of the pantry front, where the shelves are seen. */
const OPENING = { bottom: PANTRY_DIMENSIONS.opening.minY, top: PANTRY_DIMENSIONS.opening.maxY, halfW: PANTRY_DIMENSIONS.opening.maxX };

type Pose = { pos: THREE.Vector3; target: THREE.Vector3 };

export type FrameBounds = { minX: number; maxX: number; minY: number; maxY: number };

function closedPose(b: FrameBounds, aspect: number, out: Pose) {
  // Everything worth framing (pantry, letters, EZ sign, stool + plant) plus a strip of floor below.
  const left = b.minX - 0.1;
  const right = b.maxX + 0.1;
  const bottom = b.minY - 0.35;
  const top = b.maxY + 0.15;
  const cx = (left + right) / 2;
  const cy = (bottom + top) / 2;
  const d = fitDistance((right - left) / 2, (top - bottom) / 2, aspect);
  out.pos.set(cx, cy + 0.45, d);
  out.target.set(cx, cy, 0);
}

export function CameraRig({
  phase,
  clock,
  scroll,
  shelfOrigin,
  contentHeight,
  frame,
  focus,
  noteTarget,
}: {
  phase: PantryPhase;
  clock: MutableRefObject<PhaseClock>;
  scroll: ShelfScroll;
  /** world position of the shelf column origin (top-centre of the shelf front edge) */
  shelfOrigin: Vec3;
  /** shelf content height (positive) */
  contentHeight: number;
  /** closed-view framing box (PANTRY_DIMENSIONS.bounds) */
  frame: FrameBounds;
  focus: MutableRefObject<CameraFocus>;
  /** the paper the `list` phase flies to (default the List) */
  noteTarget?: MutableRefObject<NoteKind>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const pose = useRef({
    closed: { pos: new THREE.Vector3(), target: new THREE.Vector3() } as Pose,
    shelves: { pos: new THREE.Vector3(), target: new THREE.Vector3() } as Pose,
    door: { pos: new THREE.Vector3(), target: new THREE.Vector3() } as Pose,
    note: { pos: new THREE.Vector3(), target: new THREE.Vector3() } as Pose,
    from: { pos: new THREE.Vector3(), target: new THREE.Vector3() } as Pose,
    lookAt: new THREE.Vector3(0, 1.8, 0),
    desiredPos: new THREE.Vector3(),
    desiredTarget: new THREE.Vector3(),
    focusX: 0,
    focusK: 1,
    lastPhase: phase as PantryPhase | null,
    initialised: false,
  }).current;

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const aspect = size.width / Math.max(1, size.height);
    const [sx, sy, sz] = shelfOrigin;

    // Viewport-dependent scroll bounds + pixel → world factor at the shelf front plane.
    const b = shelfScrollBounds(contentHeight, aspect);
    scroll.bounds.current.min = b.min;
    scroll.bounds.current.max = b.max;
    scroll.pxToWorld.current = b.viewHeight / Math.max(1, size.height);
    scroll.step(dt);

    // Poses.
    closedPose(frame, aspect, pose.closed);
    const d = shelfDistance(aspect);
    const f = focus.current;
    const fk = 1 - Math.exp(-dt * 5);
    pose.focusX += ((f ? f.x * 0.7 : 0) - pose.focusX) * fk;
    pose.focusK += ((f ? FOCUS_ZOOM : 1) - pose.focusK) * fk;
    const cy = sy - scroll.state.current.y;
    pose.shelves.pos.set(sx + pose.focusX, cy, sz + d * pose.focusK);
    pose.shelves.target.set(sx + pose.focusX, cy, sz - 0.2);

    // Door pose: close enough that only the opening fills the view (so hiding the exterior never pops).
    const doorDist = Math.min((OPENING.halfW - 0.05) / (TAN * aspect), (OPENING.top - OPENING.bottom) / 2 / TAN, d * 0.75);
    const halfH = doorDist * TAN;
    const doorY = THREE.MathUtils.clamp(cy, OPENING.bottom + halfH, OPENING.top - halfH);
    pose.door.pos.set(sx, doorY, doorDist);
    pose.door.target.set(sx, doorY, sz - 0.2);

    // Note pose: straight on to the target paper, close enough that it fills NOTE_FILL of the width (all papers share
    // the List's size).
    const { width, height } = PANTRY_DIMENSIONS.note;
    const target = noteTarget?.current ?? "list";
    const N = target === "me" ? PANTRY_DIMENSIONS.meNote : target === "week" ? PANTRY_DIMENSIONS.weekNote : PANTRY_DIMENSIONS.note;
    pose.note.pos.set(N.x, N.y, N.z + noteDistance(width, height, aspect));
    pose.note.target.set(N.x, N.y, N.z);

    if (phase !== pose.lastPhase) {
      if (phase === "closing") {
        pose.from.pos.copy(camera.position);
        pose.from.target.copy(pose.lookAt);
      }
      pose.lastPhase = phase;
    }

    const desiredPos = pose.desiredPos;
    const desiredTarget = pose.desiredTarget;
    let rate = 0; // 0 = snap to desired
    if (phase === "zooming") {
      const e = easeInOutCubic(clock.current.zoom);
      desiredPos.lerpVectors(pose.closed.pos, pose.door.pos, e);
      desiredTarget.lerpVectors(pose.closed.target, pose.door.target, e);
    } else if (phase === "closing") {
      const e = easeInOutCubic(1 - clock.current.zoom);
      desiredPos.lerpVectors(pose.from.pos, pose.closed.pos, e);
      desiredTarget.lerpVectors(pose.from.target, pose.closed.target, e);
    } else if (phase === "list") {
      const e = easeInOutCubic(THREE.MathUtils.clamp(clock.current.list / LIST_CAMERA_END, 0, 1));
      desiredPos.lerpVectors(pose.closed.pos, pose.note.pos, e);
      desiredTarget.lerpVectors(pose.closed.target, pose.note.target, e);
    } else if (phase === "shelves") {
      desiredPos.copy(pose.shelves.pos);
      desiredTarget.copy(pose.shelves.target);
      rate = 9;
    } else {
      desiredPos.copy(pose.closed.pos);
      desiredTarget.copy(pose.closed.target);
      rate = 6;
    }

    if (!pose.initialised || rate === 0) {
      camera.position.copy(desiredPos);
      pose.lookAt.copy(desiredTarget);
      pose.initialised = true;
    } else {
      const k = 1 - Math.exp(-dt * rate);
      // Scrolling must feel glued to the finger: follow y much faster than the dolly.
      const ky = phase === "shelves" ? 1 - Math.exp(-dt * 30) : k;
      camera.position.x += (desiredPos.x - camera.position.x) * k;
      camera.position.y += (desiredPos.y - camera.position.y) * ky;
      camera.position.z += (desiredPos.z - camera.position.z) * k;
      pose.lookAt.x += (desiredTarget.x - pose.lookAt.x) * k;
      pose.lookAt.y += (desiredTarget.y - pose.lookAt.y) * ky;
      pose.lookAt.z += (desiredTarget.z - pose.lookAt.z) * k;
    }
    camera.lookAt(pose.lookAt);
  });

  return null;
}
