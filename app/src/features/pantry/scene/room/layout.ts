// World placement of the room props (SPEC "Round 3" + addenda). Pure numbers, no three.js imports, so stations.ts and
// the tests can use them cheaply. Exterior coordinates: pantry front face centred at x=0, floor y=0, front face z=0,
// back wall at z = PANTRY_DIMENSIONS.wallZ. "LEFT wall" / "RIGHT wall" in the SPEC = the back wall left / right of
// the pantry (every prop here hangs on the back wall plane, except the scanner on the stool and the calendar on the
// pantry's left stile).
import { PANTRY_DIMENSIONS as D } from "../exterior/dimensions";

export type V3 = [number, number, number];
/** Axis-aligned box: centre + full size (world units). */
export type Box = { center: V3; size: V3 };

export const WALL_Z = D.wallZ;

export const ROOM_BOUNDS = {
  minX: -3.4,
  maxX: 3.6,
  minY: 0,
  maxY: 4.6,
  minZ: D.wallZ,
  maxZ: 1.0,
} as const;

/**
 * Stool + seat, mirrored from exterior/builders.ts (STOOL_POS = [1.82, 0, 0.42], SEAT_TOP = 0.585, seat radius ~0.25,
 * pot base radius ~0.085). They are module-private there; __tests__/stations.test.ts reads builders.ts and fails if
 * they drift.
 */
export const STOOL = { x: 1.82, z: 0.42, seatTop: 0.585, seatRadius: 0.25, potBaseRadius: 0.088 } as const;

// --- Me station: chalkboard + apron on a hook (LEFT wall, SPEC centre ≈ (-2.35, 1.9)) -------------------------
export const ME_BOARD = { x: -2.15, y: 1.93, w: 0.8, h: 0.6, depth: 0.04, tilt: 0.012 } as const;
/** Hook point the apron hangs from. The apron is ~0.48 wide and hangs ~1.0 below the hook. */
export const ME_HOOK = { x: -2.88, y: 2.44 } as const;
export const APRON = { top: -0.16, length: 0.82, bibW: 0.2, skirtW: 0.46, hemW: 0.5 } as const;

// --- Household: cork board above the stool (RIGHT wall, SPEC centre ≈ (2.45, 2.35)) ---------------------------
export const CORK_BOARD = { x: 2.45, y: 2.35, w: 1.3, h: 0.92, depth: 0.05 } as const;

// --- Settings: light switch near the pantry (SPEC ≈ (-1.55, 1.35)) ---------------------------------------------
export const LIGHT_SWITCH = { x: -1.55, y: 1.35, w: 0.085, h: 0.13 } as const;

// --- Recipes: small wall shelf with a stack of books (addendum ≈ (-1.75, 2.55)) --------------------------------
/** Shelf top surface centre (the books stand on it); shelf is `w` wide and `depth` deep. */
export const BOOK_SHELF = { x: -1.72, y: 2.46, w: 0.5, depth: 0.2 } as const;

// --- Scan: handheld scanner lying on the stool seat beside the plant pot ---------------------------------------
/** Scanner group origin on the seat surface, yaw (radians about +y) and scale: in front of the pot, handle toward the camera. */
export const SCANNER = { x: 1.776, z: 0.542, yaw: -0.3, scale: 0.85 } as const;

// --- Meal prep: hanging calendar on the pantry's LEFT front stile (mirror of the list note) -------------------
const N = D.note;
/**
 * Paper centre on the left stile. The stile runs x∈[-width/2, -door.hingeX]; the right paper edge stays left of the
 * hinge line (-hingeX) so the left door (hinged there, swinging out in front of the face) never clips it.
 */
export const CALENDAR = {
  x: -(D.door.hingeX + 0.012 + 0.11),
  y: N.y - 0.06,
  z: N.z,
  width: 0.22,
  height: 0.34,
  rotZ: 0.035,
} as const;

// --- Hit boxes (generous, invisible). Wall props sit in front of the wall; the calendar's box is deep enough that
// its front face (z=0.62) is in front of the pantry's tap-to-open box (front z=0.5), exactly like the list note. ---
export const HIT = {
  meBoard: { center: [ME_BOARD.x - 0.02, ME_BOARD.y + 0.0, WALL_Z + 0.12], size: [0.9, 0.75, 0.24] } as Box,
  meApron: { center: [ME_HOOK.x, ME_HOOK.y - 0.5, WALL_Z + 0.12], size: [0.56, 1.22, 0.24] } as Box,
  household: { center: [CORK_BOARD.x, CORK_BOARD.y, WALL_Z + 0.13], size: [1.46, 1.08, 0.26] } as Box,
  lightSwitch: { center: [LIGHT_SWITCH.x, LIGHT_SWITCH.y - 0.01, WALL_Z + 0.15], size: [0.26, 0.3, 0.3] } as Box,
  books: { center: [BOOK_SHELF.x, BOOK_SHELF.y + 0.12, WALL_Z + 0.16], size: [0.6, 0.46, 0.32] } as Box,
  scanner: { center: [SCANNER.x + 0.01, STOOL.seatTop + 0.08, SCANNER.z + 0.03], size: [0.36, 0.2, 0.32] } as Box,
  calendar: { center: [CALENDAR.x - 0.01, CALENDAR.y + 0.01, 0.27], size: [0.34, 0.54, 0.7] } as Box,
} as const;

/** Visual extents of each prop (for camera framing + tests). */
export const VISUAL = {
  me: { min: [-3.13, 1.4, WALL_Z], max: [ME_BOARD.x + ME_BOARD.w / 2, ME_HOOK.y + 0.06, WALL_Z + 0.08] },
  household: {
    min: [CORK_BOARD.x - CORK_BOARD.w / 2, CORK_BOARD.y - CORK_BOARD.h / 2, WALL_Z],
    max: [CORK_BOARD.x + CORK_BOARD.w / 2 + 0.03, CORK_BOARD.y + CORK_BOARD.h / 2 + 0.03, WALL_Z + 0.08],
  },
  lightSwitch: {
    min: [LIGHT_SWITCH.x - LIGHT_SWITCH.w / 2, LIGHT_SWITCH.y - LIGHT_SWITCH.h / 2, WALL_Z],
    max: [LIGHT_SWITCH.x + LIGHT_SWITCH.w / 2, LIGHT_SWITCH.y + LIGHT_SWITCH.h / 2, WALL_Z + 0.05],
  },
  books: {
    min: [BOOK_SHELF.x - BOOK_SHELF.w / 2, BOOK_SHELF.y - 0.16, WALL_Z],
    max: [BOOK_SHELF.x + BOOK_SHELF.w / 2, BOOK_SHELF.y + 0.3, WALL_Z + BOOK_SHELF.depth + 0.02],
  },
  scanner: {
    min: [SCANNER.x - 0.13, STOOL.seatTop, SCANNER.z - 0.12],
    max: [SCANNER.x + 0.13, STOOL.seatTop + 0.06, SCANNER.z + 0.12],
  },
  calendar: {
    min: [CALENDAR.x - CALENDAR.width / 2, CALENDAR.y - CALENDAR.height / 2, 0],
    max: [CALENDAR.x + CALENDAR.width / 2, CALENDAR.y + CALENDAR.height / 2 + 0.05, 0.04],
  },
} as const satisfies Record<string, { min: V3; max: V3 }>;
