// Floor + back wall + baseboard for the whole room (and optional side walls at the room bounds).
// It sits a few millimetres proud of the exterior's own wall / floor / baseboard, so it can be mounted alongside the
// current PantryExterior without z-fighting (it simply covers them); once integrated the exterior should stop drawing
// its own (see RoomShell.tsx).
import { BufferAttribute, type BufferGeometry, Color, PlaneGeometry } from "three";

import { bevelBox, place } from "../../exterior/geometry";
import { ROOM_BOUNDS, WALL_Z } from "../layout";
import { boxUV, type Part, PartSet, shade } from "./common";

export const SHELL = {
  /** in front of the exterior wall (z = wallZ) */
  wallZ: WALL_Z + 0.003,
  /** above the exterior floor (y = 0) */
  floorY: 0.002,
  wallHeight: 9,
  /** how far the floor / side walls reach toward the camera */
  floorDepth: 14,
  /** extra width each side when there are no side walls (camera never sees an edge) */
  openMargin: 8,
  baseboard: { h: 0.16, d: 0.04 },
} as const;

/** Wall colour multiplier: a touch darker toward the floor (same gradient as the exterior wall). */
const WALL_LO = new Color("#E9D9C5");
const WALL_HI = new Color("#F3E9DC");

function gradient(geo: BufferGeometry, dim = 1): BufferGeometry {
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / 4.5));
    col[i * 3] = ((WALL_LO.r + (WALL_HI.r - WALL_LO.r) * t) / WALL_HI.r) * dim;
    col[i * 3 + 1] = ((WALL_LO.g + (WALL_HI.g - WALL_LO.g) * t) / WALL_HI.g) * dim;
    col[i * 3 + 2] = ((WALL_LO.b + (WALL_HI.b - WALL_LO.b) * t) / WALL_HI.b) * dim;
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  return geo;
}

function plane(w: number, h: number, segH = 8): BufferGeometry {
  const g = new PlaneGeometry(w, h, 1, segH).toNonIndexed();
  return g;
}

export function buildShell(sideWalls: boolean): Part[] {
  const set = new PartSet();
  const minX = sideWalls ? ROOM_BOUNDS.minX : ROOM_BOUNDS.minX - SHELL.openMargin;
  const maxX = sideWalls ? ROOM_BOUNDS.maxX : ROOM_BOUNDS.maxX + SHELL.openMargin;
  const width = maxX - minX;
  const cx = (minX + maxX) / 2;
  const H = SHELL.wallHeight;

  // back wall (UVs in metres)
  const wall = plane(width, H);
  wall.translate(cx, H / 2, SHELL.wallZ);
  boxUV(wall, 1);
  set.add("wall", gradient(wall), { cast: false });

  // floor (UVs in metres: u = x, v = -z, planks run along x like the exterior)
  const floor = new PlaneGeometry(width, SHELL.floorDepth).toNonIndexed();
  floor.rotateX(-Math.PI / 2);
  floor.translate(cx, SHELL.floorY, SHELL.wallZ + SHELL.floorDepth / 2);
  const fp = floor.getAttribute("position");
  const fuv = new Float32Array(fp.count * 2);
  for (let i = 0; i < fp.count; i++) {
    fuv[i * 2] = fp.getX(i);
    fuv[i * 2 + 1] = -fp.getZ(i);
  }
  floor.setAttribute("uv", new BufferAttribute(fuv, 2));
  set.add("floor", shade(floor, 0), { cast: false });

  // baseboard: covers the exterior's (16 x 0.15 x 0.035) completely
  const { h: bh, d: bd } = SHELL.baseboard;
  const board = (len: number, pos: [number, number, number], rotY: number) => {
    const g = bevelBox(len, bh, bd, 0.01);
    boxUV(g, 4);
    shade(g, 0.01);
    return place(g, pos, [0, rotY, 0]);
  };
  set.add("trim", board(width, [cx, bh / 2, SHELL.wallZ + bd / 2], 0));

  if (sideWalls) {
    const depth = SHELL.floorDepth;
    for (const side of [-1, 1] as const) {
      const x = side < 0 ? minX : maxX;
      const g = plane(depth, H);
      // PlaneGeometry faces +z; turn it to face into the room
      g.rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2);
      g.translate(x, H / 2, SHELL.wallZ + depth / 2);
      boxUV(g, 1);
      set.add("wall", gradient(g, 0.97), { cast: false });
      set.add("trim", board(depth, [x - side * (bd / 2), bh / 2, SHELL.wallZ + depth / 2], Math.PI / 2));
    }
  }
  return set.build();
}
