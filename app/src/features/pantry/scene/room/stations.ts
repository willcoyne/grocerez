// Camera framings for every place in the room (SPEC "Round 3": the nav moves the camera between stations).
// A station is framed straight on: the camera sits on the +z side of `focus`, far enough that a
// `fitWidth` x `fitHeight` rectangle centred on `focus` (in the plane z = focus[2]) fits the viewport — the same
// rule as motion.ts `fitDistance`. Use `stationCamera()` to turn a station into a camera pose for a given aspect.
// Pure (no three.js / React), so it is cheap to test and safe to import anywhere.
import { PANTRY_DIMENSIONS as D } from "../exterior/dimensions";
import { fitDistance, NOTE_FILL } from "../motion";
import { ROOM_BOUNDS, VISUAL, type V3 } from "./layout";

export { ROOM_BOUNDS } from "./layout";

/** List, Me and Week are the papers pinned on the pantry (the `list` phase flies to them); the rest are room props. */
export type RoomStationId = "pantry" | "list" | "me" | "week" | "household" | "scan";

export type RoomStation = {
  id: RoomStationId;
  /** look-at point; the framed rectangle lies in the plane z = focus[2] */
  focus: V3;
  /** world width / height that must fit on screen around `focus` */
  fitWidth: number;
  fitHeight: number;
  /** human label (nav / accessibility) */
  label: string;
  /** optional look-down angle (radians): the camera orbits up around `focus` (for props lying flat, e.g. the scanner) */
  pitch?: number;
};

/** Fraction of the view height the note fills in the existing list framing (CameraRig/motion.ts `noteDistance`). */
const NOTE_FIT_H = 0.8;

function frameBox(id: RoomStationId, label: string, box: { min: readonly number[]; max: readonly number[] }, pad: number, padY = pad): RoomStation {
  const [x0, y0] = box.min;
  const [x1, y1, z1] = box.max;
  return {
    id,
    label,
    focus: [(x0 + x1) / 2, (y0 + y1) / 2, z1],
    fitWidth: x1 - x0 + 2 * pad,
    fitHeight: y1 - y0 + 2 * padY,
  };
}

/** The closed-pantry framing used by CameraRig (`closedPose`): bounds + 0.1 sides, 0.35 floor strip, 0.15 top. */
function pantryStation(): RoomStation {
  const b = D.bounds;
  const left = b.minX - 0.1;
  const right = b.maxX + 0.1;
  const bottom = b.minY - 0.35;
  const top = b.maxY + 0.15;
  return {
    id: "pantry",
    label: "Pantry",
    focus: [(left + right) / 2, (bottom + top) / 2, 0],
    fitWidth: right - left,
    fitHeight: top - bottom,
  };
}

/** A pinned paper, framed exactly like the `list` phase (the paper fills NOTE_FILL of the width; all share the List's size). */
function paperStation(id: "list" | "me" | "week", label: string, n: { x: number; y: number; z: number }): RoomStation {
  return { id, label, focus: [n.x, n.y, n.z], fitWidth: D.note.width / NOTE_FILL, fitHeight: D.note.height / NOTE_FIT_H };
}

export const ROOM_STATIONS: readonly RoomStation[] = [
  pantryStation(),
  paperStation("list", "Shopping list", D.note),
  paperStation("me", "Me", D.meNote),
  paperStation("week", "Week", D.weekNote),
  frameBox("household", "Household", VISUAL.household, 0.16),
  { ...frameBox("scan", "Scan a barcode", VISUAL.scanner, 0.24, 0.2), pitch: 0.62 },
];

export function getStation(id: RoomStationId): RoomStation {
  const s = ROOM_STATIONS.find((st) => st.id === id);
  if (!s) throw new Error(`unknown room station ${id}`);
  return s;
}

/** Straight-on camera pose for a station at a viewport aspect (width / height). */
export function stationCamera(station: RoomStation, aspect: number): { position: V3; target: V3; distance: number } {
  const distance = fitDistance(station.fitWidth / 2, station.fitHeight / 2, aspect);
  const [x, y, z] = station.focus;
  const p = station.pitch ?? 0;
  return { position: [x, y + distance * Math.sin(p), z + distance * Math.cos(p)], target: [x, y, z], distance };
}

/** Framing of the whole room (wide establishing shot / dev preview). */
export const ROOM_OVERVIEW: Omit<RoomStation, "id" | "label"> = {
  focus: [(ROOM_BOUNDS.minX + ROOM_BOUNDS.maxX) / 2, (ROOM_BOUNDS.minY + ROOM_BOUNDS.maxY) / 2 - 0.1, 0],
  fitWidth: ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX,
  fitHeight: ROOM_BOUNDS.maxY - ROOM_BOUNDS.minY + 0.5,
};
