// Light switch geometry (plate-local: centre of the plate, wall at z = 0). The toggle lever is separate so it can flip.
import { CylinderGeometry } from "three";

import { LIGHT_SWITCH } from "../layout";
import { block, type Part, PartSet, prepPiece } from "./common";

export const PLATE_DEPTH = 0.009;
/** Lever pivot (plate-local) and its angle about +x: tip up-and-out when on, down-and-out when off. */
export const TOGGLE = { pivot: [0, 0, PLATE_DEPTH + 0.001] as [number, number, number], on: 0.42, off: Math.PI - 0.42 };

/** Lever angle for a 0..1 flip progress (0 = off, 1 = on). Pure. */
export function toggleAngle(onAmount: number): number {
  const k = Math.min(1, Math.max(0, onAmount));
  return TOGGLE.off + (TOGGLE.on - TOGGLE.off) * k;
}

function buildPlate(): Part[] {
  const set = new PartSet();
  const { w, h } = LIGHT_SWITCH;
  set.add("plastic", block([w, h, PLATE_DEPTH], [0, 0, PLATE_DEPTH / 2], { r: 0.0035, perM: 20 }));
  // dark slot the lever comes out of
  set.add("ink", block([0.02, 0.04, 0.0012], [0, 0, PLATE_DEPTH + 0.0002], { r: 0.0005 }), { overrides: { color: "#3A3530" }, cast: false });
  // screws with slots
  for (const y of [h / 2 - 0.017, -h / 2 + 0.017]) {
    set.add("metal", prepPiece(new CylinderGeometry(0.0055, 0.006, 0.0022, 12), { pos: [0, y, PLATE_DEPTH + 0.0009], rot: [Math.PI / 2, 0, 0] }));
    set.add("ink", block([0.008, 0.0012, 0.0006], [0, y, PLATE_DEPTH + 0.0021], { rot: [0, 0, 0.6], r: 0 }), { overrides: { color: "#5A544C" }, cast: false });
  }
  return set.build();
}

/** Lever, modelled along +y from the pivot (rotate about x with toggleAngle). */
function buildLever(): Part[] {
  const set = new PartSet();
  set.add("plastic", block([0.013, 0.034, 0.011], [0, 0.017, 0], { r: 0.0045, perM: 20 }));
  return set.build();
}

let shared: { plate: Part[]; lever: Part[] } | null = null;
export function getSwitchShared() {
  shared ??= { plate: buildPlate(), lever: buildLever() };
  return shared;
}
