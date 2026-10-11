// World layout of the pantry exterior (SPEC.md): front face centred at x=0, floor at y=0, front face at z=0.
// The camera rig frames the scene from these numbers, so keep them in sync with the geometry builders.

const DEG = Math.PI / 180;

export const PANTRY_DIMENSIONS = {
  /** cabinet body (without crown overhang) */
  width: 2.2,
  height: 3.2,
  depth: 0.9,
  /** chunky top board */
  crownWidth: 2.5,
  crownTop: 3.46,
  crownFrontZ: 0.12,
  /** where the shelves are seen through the doors */
  opening: { minX: -0.85, maxX: 0.85, minY: 0.15, maxY: 2.95, minZ: -0.85, maxZ: 0 },
  /** doors (overlay doors, hinged at the outer edges) */
  door: { width: 0.875, height: 2.84, thickness: 0.05, bottomY: 0.13, hingeX: 0.88, hingeZ: 0.06 },
  doorOpenAngle: 110 * DEG,
  /** "Grocer" letters stand on the crown */
  lettersSize: 0.34,
  lettersTop: 3.73,
  /** EZ sign hangs from a nail on the wall */
  signNail: [0.98, 4.3, -0.93] as const,
  /** paper shopping list pinned on the right stile: centre, size, tilt (radians about z) */
  note: { x: 0.99, y: 2.1, z: 0.004, width: 0.23, height: 0.37, rotZ: -0.06 },
  /** the Week note (spec §13), pinned just below the list on the same stile, tilted the other way */
  weekNote: { x: 0.99, y: 1.64, z: 0.004, rotZ: 0.045 },
  /** back wall plane and floor */
  wallZ: -0.95,
  /** everything worth framing (incl. the stool + plant at the right) */
  bounds: { minX: -1.3, maxX: 2.25, minY: 0, maxY: 4.4, minZ: -0.95, maxZ: 0.75 },
  /** a good look-at target for the closed view */
  focus: [0.25, 2.0, 0] as const,
} as const;

export type PantryDimensions = typeof PANTRY_DIMENSIONS;
