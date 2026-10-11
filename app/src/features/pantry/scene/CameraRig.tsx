/* eslint-disable react-hooks/immutability -- the rig mutates the three.js camera and shared scroll refs in useFrame by design */
/**
 * Camera rig. Owns the scene camera every frame:
 * - closed / opening: frames the whole closed pantry (letters, EZ sign, stool) — fit-width on portrait screens.
 * - zooming: eased dolly from the closed framing through the doorway (`clock.zoom` 0..1).
 * - shelves: follows the shelf scroll (`scroll.state.y`, advanced here via `scroll.step`) and eases to a searched
 *   item (`focus`), with critically-damped smoothing so phase changes never pop. A tapped (flipped) item's focus carries
 *   its back label: the camera then glides in straight on until the label fills ~82% of the view, and back out when
 *   the selection clears. Reduced motion: these moves cut instead of gliding.
 * - closing: glides from wherever the camera was into the doorway pose (exterior still hidden), then pulls back to the
 *   closed framing (`clock.zoom` 1..0, see motion.ts closingCamera), so revealing the exterior never pops.
 * - list: flies from the closed framing to a pinned paper (`noteTarget`: List, Me or Week) so it fills ~70% of the width
 *   (`clock.list` 0..LIST_CAMERA_END; the paper then lifts toward the lens, see exterior/animation.ts) and back.
 * - room stations (closed phase + `station`): glides (eased, STATION_GLIDE_S) to the station's framing in the top
 *   strip a station sheet leaves visible (motion.ts stationPeekPose; the scanner, whose sheet is full-screen, is framed
 *   whole and from above, stations.ts stationCamera) and back to the closed framing when `station` clears. Reports
 *   each arrival through `onArrive` (station id, or null when back at the pantry). Reduced motion: cuts.
 * It also keeps the scroll bounds / px-to-world factor in sync with the viewport.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

import type { NoteKind, PantryPhase } from "../types";
import { PANTRY_DIMENSIONS } from "./exterior/dimensions";
import {
  closingCamera,
  easeInOutCubic,
  fitDistance,
  LIST_CAMERA_END,
  noteDistance,
  STATION_GLIDE_S,
  stationPeekPose,
  shelfDistance,
  shelfFocusTarget,
  shelfScrollBounds,
  TAN,
  type CameraFocus,
  type PhaseClock,
  type Vec3,
} from "./motion";
import { getStation, stationCamera, type RoomStationId } from "./room/stations";
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
  reducedMotion = false,
  speed = 1,
  station = null,
  onArrive,
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
  /** OS "reduce motion": focus changes (search fly-to, label zoom) and station moves cut instead of easing */
  reducedMotion?: boolean;
  /** Animation speed (the user's "fast" setting = 2): glides and smoothing run this many times faster. */
  speed?: number;
  /** closed phase only: the room station to frame (null = the closed pantry) */
  station?: RoomStationId | null;
  /** the camera finished gliding to `station` (null = back at the closed pantry framing) */
  onArrive?: (station: RoomStationId | null) => void;
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
    /** smoothed shelf-local camera z, look-at z and label-height offset (see shelfFocusTarget) */
    focusZ: NaN,
    focusLookZ: -0.2,
    focusDY: 0,
    lastPhase: phase as PantryPhase | null,
    initialised: false,
    /** station glide (closed phase): target key ("off" outside the closed phase), progress, start pose */
    glide: {
      key: "off" as RoomStationId | null | "off",
      t: 0,
      arrived: true,
      from: { pos: new THREE.Vector3(), target: new THREE.Vector3() } as Pose,
      to: { pos: new THREE.Vector3(), target: new THREE.Vector3() } as Pose,
    },
  }).current;
  const arrive = useRef(onArrive);
  useEffect(() => {
    arrive.current = onArrive;
  }, [onArrive]);

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
    const cy = sy - scroll.state.current.y;
    const ft = shelfFocusTarget(focus.current, aspect);
    const fk = reducedMotion ? 1 : 1 - Math.exp(-dt * 5 * speed);
    if (Number.isNaN(pose.focusZ)) pose.focusZ = ft.camZ;
    pose.focusX += (ft.x - pose.focusX) * fk;
    pose.focusZ += (ft.camZ - pose.focusZ) * fk;
    pose.focusLookZ += (ft.lookZ - pose.focusLookZ) * fk;
    // a label is framed at its own height (the scroll may be clamped at the column's ends)
    pose.focusDY += ((ft.y === null ? 0 : sy + ft.y - cy) - pose.focusDY) * fk;
    pose.shelves.pos.set(sx + pose.focusX, cy + pose.focusDY, sz + pose.focusZ);
    pose.shelves.target.set(sx + pose.focusX, cy + pose.focusDY, sz + pose.focusLookZ);

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
      // into the doorway first (exterior still hidden), then pull back (see motion.ts closingCamera / exteriorShown)
      const c = closingCamera(clock.current.zoom);
      const a = c.toDoor ? pose.from : pose.door;
      const b = c.toDoor ? pose.door : pose.closed;
      desiredPos.lerpVectors(a.pos, b.pos, c.e);
      desiredTarget.lerpVectors(a.target, b.target, c.e);
    } else if (phase === "list") {
      const e = easeInOutCubic(THREE.MathUtils.clamp(clock.current.list / LIST_CAMERA_END, 0, 1));
      desiredPos.lerpVectors(pose.closed.pos, pose.note.pos, e);
      desiredTarget.lerpVectors(pose.closed.target, pose.note.target, e);
    } else if (phase === "shelves") {
      desiredPos.copy(pose.shelves.pos);
      desiredTarget.copy(pose.shelves.target);
      rate = reducedMotion ? 0 : 9;
    } else if (phase !== "closed") {
      // opening: hold the closed framing while the doors swing
      desiredPos.copy(pose.closed.pos);
      desiredTarget.copy(pose.closed.target);
      rate = 6;
    } else {
      // closed: the pantry framing, or a room station (eased glide between them, then follow at rate 6)
      const g = pose.glide;
      const key = station;
      if (key !== g.key) {
        // Arriving in `closed` from another phase lands on the closed framing already: no glide.
        const fromOtherPhase = g.key === "off" || !pose.initialised;
        g.key = key;
        g.t = 0;
        g.arrived = fromOtherPhase && key === null;
        g.from.pos.copy(camera.position);
        g.from.target.copy(pose.lookAt);
        if (g.arrived) arrive.current?.(null);
      }
      if (key) {
        const st = getStation(key);
        // the scanner opens a full-screen sheet: frame it whole (and from above); others sit above a station sheet
        const p = key === "scan" ? stationCamera(st, aspect) : stationPeekPose(st, aspect);
        g.to.pos.set(p.position[0], p.position[1], p.position[2]);
        g.to.target.set(p.target[0], p.target[1], p.target[2]);
      } else {
        g.to.pos.copy(pose.closed.pos);
        g.to.target.copy(pose.closed.target);
      }
      if (!g.arrived) {
        g.t += dt;
        const dur = reducedMotion ? 0 : STATION_GLIDE_S / speed;
        const k = dur > 0 ? THREE.MathUtils.clamp(g.t / dur, 0, 1) : 1;
        const e = easeInOutCubic(k);
        desiredPos.lerpVectors(g.from.pos, g.to.pos, e);
        desiredTarget.lerpVectors(g.from.target, g.to.target, e);
        if (k >= 1) {
          g.arrived = true;
          arrive.current?.(key);
        }
      } else {
        desiredPos.copy(g.to.pos);
        desiredTarget.copy(g.to.target);
        rate = 6;
      }
    }
    if (phase !== "closed") pose.glide.key = "off";

    if (!pose.initialised || rate === 0) {
      camera.position.copy(desiredPos);
      pose.lookAt.copy(desiredTarget);
      pose.initialised = true;
    } else {
      const k = 1 - Math.exp(-dt * rate * speed);
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
