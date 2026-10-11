// Handheld barcode scanner (gun style) lying on its side on the stool seat, with a faint red scan line on the seat.
// Local frame: origin on the seat surface under the scanner, +y up, nose pointing -x, handle pointing +z.
import { ExtrudeGeometry, PlaneGeometry, Shape, BufferGeometry, Float32BufferAttribute } from "three";

import { block, type Part, PartSet, prepPiece } from "./common";

const BODY_T = 0.03; // extrude depth
const BEVEL = 0.008;
export const SCANNER_THICKNESS = BODY_T + 2 * BEVEL;
const LIE: [number, number, number] = [-Math.PI / 2, 0, 0];

/** Side profile, nose at -x, handle down (-y), in metres. */
function profile(): Shape {
  const s = new Shape();
  s.moveTo(-0.072, 0.03);
  s.quadraticCurveTo(0.0, 0.034, 0.062, 0.02);
  s.quadraticCurveTo(0.076, 0.016, 0.074, 0.0);
  s.lineTo(0.07, -0.016);
  s.quadraticCurveTo(0.068, -0.024, 0.074, -0.04);
  s.lineTo(0.088, -0.108);
  s.quadraticCurveTo(0.09, -0.122, 0.076, -0.124);
  s.lineTo(0.054, -0.124);
  s.quadraticCurveTo(0.042, -0.122, 0.04, -0.11);
  s.lineTo(0.026, -0.04);
  s.quadraticCurveTo(0.02, -0.026, 0.0, -0.026);
  s.lineTo(-0.068, -0.03);
  s.quadraticCurveTo(-0.078, -0.03, -0.078, -0.018);
  s.lineTo(-0.078, 0.02);
  s.quadraticCurveTo(-0.078, 0.03, -0.072, 0.03);
  return s;
}

/** Lying-down transform helper: profile (x, y, z∈thickness) → local. */
function lie(geo: BufferGeometry, lift = SCANNER_THICKNESS / 2): BufferGeometry {
  geo.rotateX(LIE[0]);
  geo.translate(0, lift, 0);
  return geo;
}

function buildBody(): Part[] {
  const set = new PartSet();
  const body = new ExtrudeGeometry(profile(), { depth: BODY_T, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: 0.006, bevelSegments: 2, curveSegments: 5 });
  body.translate(0, 0, -BODY_T / 2);
  set.add("plastic", lie(prepPiece(body, { perM: 20 })), { overrides: { color: "#34373D" } });
  // yellow rubber bumper round the nose
  set.add("plastic", lie(block([0.022, 0.078, SCANNER_THICKNESS + 0.004], [-0.066, 0.002, 0], { r: 0.006, perM: 20 })), { overrides: { color: "#F2B233" } });
  // grip insert on the handle
  set.add(
    "plastic",
    lie(block([0.024, 0.07, SCANNER_THICKNESS + 0.002], [0.064, -0.08, 0], { rot: [0, 0, 0.2], r: 0.006, perM: 20 })),
    { overrides: { color: "#24262A" } },
  );
  // trigger
  set.add("plastic", lie(block([0.012, 0.026, 0.016], [0.018, -0.04, 0], { rot: [0, 0, 0.35], r: 0.004 })), { overrides: { color: "#F2B233" } });
  // dark bezel + red exit window on the nose face
  set.add("ink", lie(block([0.004, 0.056, 0.036], [-0.0795, 0.002, 0], { r: 0.0015 })), { overrides: { color: "#1C1D20" }, cast: false });
  // a few status LEDs on the top
  set.add("glow", lie(block([0.006, 0.004, 0.006], [0.03, 0.031, 0.01], { r: 0.001 })), { overrides: { color: "#59D66B", opacity: 0.9 }, cast: false, receive: false });
  return set.build();
}

/** Red window + scan fan + the line it paints on the seat (all additive glow). */
function buildBeam(): Part[] {
  const set = new PartSet();
  set.add("glow", lie(block([0.0015, 0.046, 0.028], [-0.0822, 0.002, 0], { r: 0 })), { overrides: { color: "#FF3B30", opacity: 0.85 }, cast: false, receive: false });
  // fan from the window down onto the seat ahead of the nose (a thin vertical triangle per side, soft)
  const ny = SCANNER_THICKNESS / 2;
  const fan = new BufferGeometry();
  const L = 0.075;
  fan.setAttribute(
    "position",
    new Float32BufferAttribute([-0.083, ny, -0.01, -0.083 - L, 0.001, -0.05, -0.083 - L, 0.001, 0.05, -0.083, ny, 0.01, -0.083, ny, -0.01, -0.083 - L, 0.001, 0.05], 3),
  );
  fan.computeVertexNormals();
  set.add("glow", prepPiece(fan, { jitter: 0 }), { overrides: { color: "#FF4A3D", opacity: 0.12 }, cast: false, receive: false });
  const line = new PlaneGeometry(0.005, 0.1).toNonIndexed();
  line.rotateX(-Math.PI / 2);
  set.add("glow", prepPiece(line, { pos: [-0.083 - L, 0.0015, 0], jitter: 0 }), { overrides: { color: "#FF3B30", opacity: 0.75 }, cast: false, receive: false });
  const halo = new PlaneGeometry(0.02, 0.12).toNonIndexed();
  halo.rotateX(-Math.PI / 2);
  set.add("glow", prepPiece(halo, { pos: [-0.083 - L, 0.0012, 0], jitter: 0 }), { overrides: { color: "#FF3B30", opacity: 0.18 }, cast: false, receive: false });
  return set.build();
}

let shared: { body: Part[]; beam: Part[] } | null = null;
export function getScannerShared() {
  shared ??= { body: buildBody(), beam: buildBeam() };
  return shared;
}

/** Footprint corners on the seat (local x, z) incl. the scan line, for placement tests. */
export const SCANNER_FOOTPRINT: readonly [number, number][] = [
  [-0.16, -0.05],
  [-0.16, 0.05],
  [-0.086, -0.035],
  [0.092, 0.126],
  [0.04, 0.126],
  [0.078, -0.036],
];
