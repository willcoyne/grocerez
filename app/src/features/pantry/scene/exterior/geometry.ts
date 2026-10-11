// Small geometry toolkit for the exterior: bevelled boxes, world-scale wood UVs, vertex tints and merging.
// Everything returned here is non-indexed with position/normal/uv/color so pieces can be merged freely.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  type ColorRepresentation,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  Quaternion,
  Shape,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Vec3 = readonly [number, number, number];
export type GrainAxis = "x" | "y" | "z";

/** Texture tiles per metre for the wood grain map. */
const UV_PER_M = 1.7;

function roundedRectShape(w: number, h: number, cr: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  const r = Math.min(cr, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Box centred on the origin with softly rounded edges (extruded rounded rect + bevel). */
export function bevelBox(w: number, h: number, d: number, r: number): BufferGeometry {
  const rr = Math.min(r, w * 0.45, h * 0.45, d * 0.45);
  if (rr <= 0.0005) return new BoxGeometry(w, h, d).toNonIndexed();
  const depth = Math.max(d - 2 * rr, 0.0005);
  const geo = new ExtrudeGeometry(roundedRectShape(w - 2 * rr, h - 2 * rr, rr * 0.6), {
    depth,
    bevelEnabled: true,
    bevelThickness: rr,
    bevelSize: rr,
    bevelSegments: 2,
    curveSegments: 2,
  });
  geo.translate(0, 0, -depth / 2);
  geo.clearGroups();
  return geo.index ? geo.toNonIndexed() : geo;
}

const AXES: GrainAxis[] = ["x", "y", "z"];

/**
 * World-scale planar UVs so the grain runs along `grain` on every face (end grain on faces facing that axis).
 * Projection is chosen per triangle from its face normal, so bevels don't smear.
 */
export function applyWoodUV(geo: BufferGeometry, grain: GrainAxis, seed = 0): BufferGeometry {
  const pos = geo.getAttribute("position");
  const count = pos.count;
  const uv = new Float32Array(count * 2);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const g = AXES.indexOf(grain);
  const ou = (seed * 0.371) % 1;
  const ov = (seed * 0.713) % 1;
  for (let i = 0; i + 2 < count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const dom = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    let uAxis: number;
    let vAxis: number;
    if (dom !== g) {
      vAxis = g;
      uAxis = 3 - dom - g;
    } else {
      uAxis = (g + 1) % 3;
      vAxis = (g + 2) % 3;
    }
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      uv[(i + k) * 2] = p.getComponent(uAxis) * UV_PER_M + ou;
      uv[(i + k) * 2 + 1] = p.getComponent(vAxis) * UV_PER_M + ov;
    }
  }
  geo.setAttribute("uv", new BufferAttribute(uv, 2));
  return geo;
}

/** Plain UVs (0) for pieces that don't use a map but must merge with ones that do. */
export function ensureUV(geo: BufferGeometry): BufferGeometry {
  if (!geo.getAttribute("uv")) {
    geo.setAttribute("uv", new BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2));
  }
  return geo;
}

const tmpColor = new Color();

/** Vertex tint (linear, converted from sRGB hex). Optional per-vertex jitter for a hand-made look. */
export function tint(geo: BufferGeometry, color: ColorRepresentation, jitter = 0, seed = 1): BufferGeometry {
  tmpColor.set(color);
  const count = geo.getAttribute("position").count;
  const arr = new Float32Array(count * 3);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < count; i += 3) {
    // jitter per triangle so faces read as slightly different planks/facets
    s = (s * 9301 + 49297) % 233280;
    const j = jitter ? 1 + ((s / 233280) * 2 - 1) * jitter : 1;
    for (let k = 0; k < 3 && i + k < count; k++) {
      arr[(i + k) * 3] = tmpColor.r * j;
      arr[(i + k) * 3 + 1] = tmpColor.g * j;
      arr[(i + k) * 3 + 2] = tmpColor.b * j;
    }
  }
  geo.setAttribute("color", new BufferAttribute(arr, 3));
  return geo;
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const one = new Vector3(1, 1, 1);
const v = new Vector3();

export function place(geo: BufferGeometry, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale?: Vec3): BufferGeometry {
  q.setFromEuler(e.set(rot[0], rot[1], rot[2]));
  m4.compose(v.set(pos[0], pos[1], pos[2]), q, scale ? new Vector3(scale[0], scale[1], scale[2]) : one);
  geo.applyMatrix4(m4);
  return geo;
}

export type WoodPiece = {
  size: Vec3;
  pos: Vec3;
  rot?: Vec3;
  /** edge radius; 0 = sharp box */
  r?: number;
  grain: GrainAxis;
  color: ColorRepresentation;
  jitter?: number;
};

let pieceSeed = 1;

/** A tinted, grain-mapped wooden block positioned in the parent's space. */
export function woodPiece(p: WoodPiece): BufferGeometry {
  const geo = bevelBox(p.size[0], p.size[1], p.size[2], p.r ?? 0.015);
  pieceSeed += 1;
  applyWoodUV(geo, p.grain, pieceSeed);
  tint(geo, p.color, p.jitter ?? 0, pieceSeed);
  return place(geo, p.pos, p.rot);
}

/** Non-indexed, tinted copy of any geometry (lathe, cylinder, sphere...) for merging. */
export function prep(
  geo: BufferGeometry,
  color: ColorRepresentation,
  opts: { grain?: GrainAxis; jitter?: number; pos?: Vec3; rot?: Vec3; scale?: Vec3 } = {},
): BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.clearGroups();
  if (opts.grain) {
    pieceSeed += 1;
    applyWoodUV(g, opts.grain, pieceSeed);
  } else {
    g = ensureUV(g);
  }
  tint(g, color, opts.jitter ?? 0, pieceSeed + 7);
  return place(g, opts.pos, opts.rot, opts.scale);
}

/** Merge prepared pieces into one draw call; disposes the inputs. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  // keep only the attributes every piece shares (position/normal/uv/color)
  const keep = ["position", "normal", "uv", "color"];
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) if (!keep.includes(name)) p.deleteAttribute(name);
    if (!p.getAttribute("normal")) p.computeVertexNormals();
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("PantryExterior: failed to merge geometries");
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/**
 * Merge several lists of pieces into one geometry with one draw group per list (group i -> material index i), so a
 * mesh can give parts of one merged body different materials (e.g. glowing trim). Empty lists add no group.
 */
export function mergeGrouped(groups: BufferGeometry[][]): BufferGeometry {
  const counts = groups.map((list) => list.reduce((n, g) => n + g.getAttribute("position").count, 0));
  const merged = merge(groups.flat());
  let start = 0;
  counts.forEach((count, i) => {
    if (count > 0) merged.addGroup(start, count, i);
    start += count;
  });
  return merged;
}
