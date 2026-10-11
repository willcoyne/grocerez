// Geometry toolkit for the room props, built on exterior/geometry.ts (bevelled boxes, wood UVs, merging). Builders
// collect pieces per material *role* and merge each role into one geometry (one draw call per role per prop).
// Every piece is non-indexed with position/normal/uv/color, where color is a near-white multiplier (hand-made jitter),
// never a theme colour.
import {
  BufferAttribute,
  type BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  Shape,
  TubeGeometry,
  Vector3,
} from "three";

import { advanceOf, drawableText, textGeometry } from "../../exterior/font";
import { applyWoodUV, bevelBox, type GrainAxis, merge, place, tint, type Vec3 } from "../../exterior/geometry";
import type { RoomMaterialOverrides, RoomMaterialRole } from "../roomMaterials";

export type { Vec3 } from "../../exterior/geometry";

export type Part = {
  role: RoomMaterialRole;
  overrides?: RoomMaterialOverrides;
  geometry: BufferGeometry;
  castShadow: boolean;
  receiveShadow: boolean;
};

type Opts = { overrides?: RoomMaterialOverrides; cast?: boolean; receive?: boolean };

/** Collects prepared pieces and merges them per (role, overrides). */
export class PartSet {
  private groups = new Map<string, { role: RoomMaterialRole; overrides?: RoomMaterialOverrides; geos: BufferGeometry[]; cast: boolean; receive: boolean }>();

  add(role: RoomMaterialRole, geo: BufferGeometry, opts: Opts = {}): this {
    const o = opts.overrides;
    const cast = opts.cast ?? true;
    const receive = opts.receive ?? true;
    const key = `${role}|${o ? JSON.stringify(o) : ""}|${cast}|${receive}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { role, overrides: o, geos: [], cast, receive };
      this.groups.set(key, g);
    }
    g.geos.push(geo);
    return this;
  }

  build(): Part[] {
    const out: Part[] = [];
    for (const g of this.groups.values()) {
      out.push({ role: g.role, overrides: g.overrides, geometry: merge(g.geos), castShadow: g.cast, receiveShadow: g.receive });
    }
    this.groups.clear();
    return out;
  }
}

export function disposeParts(parts: readonly Part[]) {
  for (const p of parts) p.geometry.dispose();
}

let seed = 101;
const nextSeed = () => (seed = (seed * 16807) % 2147483647);

/** Near-white per-triangle jitter so faces read as hand-made. */
export function shade(geo: BufferGeometry, jitter = 0.03, base = "#ffffff"): BufferGeometry {
  return tint(geo, base, jitter, nextSeed());
}

/** Planar UVs from local position, `perM` tiles per metre, projected on the dominant axis per triangle. */
export function boxUV(geo: BufferGeometry, perM: number): BufferGeometry {
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = nrm ? Math.abs(nrm.getX(i)) : 0;
    const ay = nrm ? Math.abs(nrm.getY(i)) : 0;
    const az = nrm ? Math.abs(nrm.getZ(i)) : 1;
    let u: number;
    let v: number;
    if (az >= ax && az >= ay) {
      u = pos.getX(i);
      v = pos.getY(i);
    } else if (ay >= ax) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else {
      u = pos.getZ(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u * perM;
    uv[i * 2 + 1] = v * perM;
  }
  geo.setAttribute("uv", new BufferAttribute(uv, 2));
  return geo;
}

function nonIndexed(geo: BufferGeometry): BufferGeometry {
  if (!geo.index) return geo;
  const g = geo.toNonIndexed();
  geo.dispose();
  return g;
}

export type PieceOpts = { pos?: Vec3; rot?: Vec3; scale?: Vec3; jitter?: number };

/** Wooden block (grain-mapped) in the parent's space. */
export function woodBlock(size: Vec3, pos: Vec3, opts: { rot?: Vec3; r?: number; grain?: GrainAxis; jitter?: number } = {}): BufferGeometry {
  const g = bevelBox(size[0], size[1], size[2], opts.r ?? 0.01);
  applyWoodUV(g, opts.grain ?? "x", nextSeed() % 97);
  shade(g, opts.jitter ?? 0.03);
  return place(g, pos, opts.rot);
}

/** Bevelled block with planar UVs (`perM` tiles per metre), for non-wood roles. */
export function block(size: Vec3, pos: Vec3, opts: { rot?: Vec3; r?: number; perM?: number; jitter?: number } = {}): BufferGeometry {
  const g = bevelBox(size[0], size[1], size[2], opts.r ?? 0.004);
  boxUV(g, opts.perM ?? 5);
  shade(g, opts.jitter ?? 0.015);
  return place(g, pos, opts.rot);
}

/** Any three.js geometry → non-indexed, planar-UV'd, shaded, placed. */
export function prepPiece(geo: BufferGeometry, opts: PieceOpts & { perM?: number; keepUV?: boolean } = {}): BufferGeometry {
  const g = nonIndexed(geo);
  g.clearGroups();
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  if (!opts.keepUV || !g.getAttribute("uv")) boxUV(g, opts.perM ?? 5);
  shade(g, opts.jitter ?? 0.015);
  return place(g, opts.pos, opts.rot, opts.scale);
}

/** Cylinder from a to b. */
export function rod(a: Vec3, b: Vec3, r: number, radial = 8, rBottom = r): BufferGeometry {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const dir = new Vector3().subVectors(va, vb);
  const geo = new CylinderGeometry(r, rBottom, dir.length(), radial, 1);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  geo.applyMatrix4(new Matrix4().compose(new Vector3().addVectors(va, vb).multiplyScalar(0.5), q, new Vector3(1, 1, 1)));
  return prepPiece(geo);
}

/** Tube along a smooth curve through `pts`. */
export function tube(pts: Vec3[], r: number, segments = 16, radial = 6): BufferGeometry {
  const curve = new CatmullRomCurve3(pts.map((p) => new Vector3(...p)));
  return prepPiece(new TubeGeometry(curve, segments, r, radial, false));
}

export function roundedRectShape(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

// --- text --------------------------------------------------------------------------------------------------------

/** Fit `text` into `maxW` at `size`: shrink down to `minScale`, then truncate with "..". Pure. */
export function fitText(text: string, size: number, maxW: number, minScale = 0.65): { text: string; scale: number } {
  let t = drawableText(text.replace(/\s+/g, " ").trim());
  const w = advanceOf(t, size);
  if (w <= maxW) return { text: t, scale: 1 };
  if (w * minScale <= maxW) return { text: t, scale: maxW / w };
  while (t.length > 1 && advanceOf(t + "..", size) * minScale > maxW) t = t.slice(0, -1);
  return { text: t.trimEnd() + "..", scale: minScale };
}

export type TextAlign = "left" | "center" | "right";

/**
 * Flat 3D text, baseline at y=0 (left/centre/right aligned at x=0), front face at z = depth.
 * `wobble` > 0 sets every glyph separately with a small random tilt and baseline drift (hand-written / chalk).
 */
export function text3d(
  str: string,
  o: { size: number; depth?: number; align?: TextAlign; wobble?: number; seed?: number; perM?: number; maxW?: number; minScale?: number },
): BufferGeometry | null {
  const depth = o.depth ?? 0.0015;
  const fitted = o.maxW ? fitText(str, o.size, o.maxW, o.minScale) : { text: drawableText(str), scale: 1 };
  const s = fitted.text;
  if (!s.trim()) return null;
  const size = o.size * fitted.scale;
  const total = advanceOf(s, size);
  const x0 = o.align === "center" ? -total / 2 : o.align === "right" ? -total : 0;
  const parts: BufferGeometry[] = [];
  if (!o.wobble) {
    const g = textGeometry(s, { size, depth, curveSegments: 3 });
    g.translate(x0, 0, 0);
    parts.push(g);
  } else {
    let r = (o.seed ?? 7) * 7919 + 13;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let cursor = x0;
    for (const ch of s) {
      const adv = advanceOf(ch, size);
      if (ch !== " ") {
        const g = textGeometry(ch, { size, depth, curveSegments: 3 });
        g.translate(-adv / 2, 0, 0);
        g.rotateZ(rand() * o.wobble * 0.9);
        g.translate(cursor + adv / 2 + rand() * size * 0.03, rand() * size * o.wobble * 0.5, 0);
        parts.push(g);
      }
      cursor += adv;
    }
  }
  if (!parts.length) return null;
  const prepared = parts.map((g) => prepPiece(g, { perM: o.perM ?? 40, jitter: 0 }));
  return merge(prepared);
}

/** Thin, slightly wavy stroke from a to b in the XY plane (chalk underline, pen lines). */
export function stroke(a: [number, number], b: [number, number], width: number, z: number, wave = 0, depth = 0.0012): BufferGeometry {
  const pts: Vec3[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI * 2) * wave;
    pts.push([x, y, z]);
  }
  const g = new TubeGeometry(new CatmullRomCurve3(pts.map((p) => new Vector3(...p))), 12, width / 2, 4, false);
  g.scale(1, 1, 1);
  const out = prepPiece(g, { jitter: 0 });
  // flatten toward the surface so it reads as a drawn line, not a wire
  const pos = out.getAttribute("position");
  for (let i = 0; i < pos.count; i++) pos.setZ(i, z + (pos.getZ(i) - z) * (depth / width));
  out.computeVertexNormals();
  return out;
}
