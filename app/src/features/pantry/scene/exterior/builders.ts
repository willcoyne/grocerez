// Pure three.js construction of the pantry exterior (no React), so it can be previewed outside the app and the
// R3F component stays thin. Shared geometry is built lazily once per theme (vertex tints come from the theme's
// exteriorPalette, 3D text from the theme font) and kept until another theme's geometry is built; only the
// shopping-list text is per instance. The room's wall / floor / baseboard are drawn by RoomShell (scene/room).
import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  BufferAttribute,
  type Material,
} from "three";

import { PANTRY_DIMENSIONS as D } from "./dimensions";
import { getActiveTheme } from "../../../theme/store";
import type { SceneTheme } from "../../../theme/types";
import { textGeometry } from "./font";
import { applyWoodUV, merge, mergeGrouped, place, prep, tint, type Vec3, woodPiece } from "./geometry";
import { type ExteriorPalette, exteriorPalette, getMaterials } from "./materials";

export { LIST_FALLBACK, listLines, ME_FALLBACK, meNoteLines, WEEK_FALLBACK, weekNoteLines } from "./list";
export const GROCER = "Grocer";

// ---------------------------------------------------------------------------------------------------------------
// helpers

function cylinderBetween(a: Vec3, b: Vec3, rTop: number, rBottom: number, radial = 6): BufferGeometry {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const dir = new Vector3().subVectors(va, vb);
  const len = dir.length();
  const geo = new CylinderGeometry(rTop, rBottom, len, radial, 1);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  const mid = new Vector3().addVectors(va, vb).multiplyScalar(0.5);
  geo.applyMatrix4(new Matrix4().compose(mid, q, new Vector3(1, 1, 1)));
  return geo;
}

function lathe(points: [number, number][], segments: number): LatheGeometry {
  return new LatheGeometry(
    points.map(([x, y]) => new Vector2(x, y)),
    segments,
  );
}

/** Ellipsoid leaf with its base at the origin, pointing up. */
function leaf(w: number, h: number, t: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, 1);
  g.translate(0, 1, 0);
  g.scale(w, h / 2, t);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// static pieces

const STOOL_POS: Vec3 = [1.82, 0, 0.42];
const SEAT_TOP = 0.585;

/** Carcass, crown and stool; group 0 = wood, group 1 = the crown's cove step (an edge strip in glowing themes). */
function buildStaticWood(P: ExteriorPalette): BufferGeometry {
  const { width, height, depth, opening } = D;
  const sideW = width / 2 - opening.maxX; // 0.25
  const parts: BufferGeometry[] = [];
  const midZ = -depth / 2;

  // carcass
  for (const s of [-1, 1]) {
    parts.push(
      woodPiece({
        size: [sideW, height, depth],
        pos: [s * (opening.maxX + sideW / 2), height / 2, midZ],
        grain: "y",
        color: P.wood,
        r: 0.022,
      }),
    );
  }
  const innerW = opening.maxX * 2;
  parts.push(
    woodPiece({
      size: [innerW + 0.02, height - opening.maxY, depth],
      pos: [0, (height + opening.maxY) / 2, midZ],
      grain: "x",
      color: P.wood,
      r: 0.018,
    }),
    woodPiece({
      size: [innerW + 0.02, opening.minY, depth],
      pos: [0, opening.minY / 2, midZ],
      grain: "x",
      color: P.wood,
      r: 0.012,
    }),
    // back panel (dark so the shelves read)
    woodPiece({
      size: [innerW + 0.02, opening.maxY - opening.minY + 0.02, 0.05],
      pos: [0, (opening.maxY + opening.minY) / 2, -depth + 0.025],
      grain: "y",
      color: P.interior,
      r: 0,
    }),
    // interior linings (darker inside faces)
    woodPiece({
      size: [0.006, opening.maxY - opening.minY, -opening.minZ - 0.02],
      pos: [opening.minX + 0.003, (opening.maxY + opening.minY) / 2, opening.minZ / 2 - 0.01],
      grain: "y",
      color: P.liningSide,
      r: 0,
    }),
    woodPiece({
      size: [0.006, opening.maxY - opening.minY, -opening.minZ - 0.02],
      pos: [opening.maxX - 0.003, (opening.maxY + opening.minY) / 2, opening.minZ / 2 - 0.01],
      grain: "y",
      color: P.liningSide,
      r: 0,
    }),
    woodPiece({
      size: [innerW, 0.006, -opening.minZ - 0.02],
      pos: [0, opening.maxY - 0.003, opening.minZ / 2 - 0.01],
      grain: "z",
      color: P.liningTop,
      r: 0,
    }),
    woodPiece({
      size: [innerW, 0.006, -opening.minZ - 0.02],
      pos: [0, opening.minY + 0.003, opening.minZ / 2 - 0.01],
      grain: "z",
      color: P.liningBottom,
      r: 0,
    }),
    // plinth / kick board, a touch proud and darker
    woodPiece({
      size: [width + 0.06, 0.1, depth + 0.03],
      pos: [0, 0.05, midZ + 0.005],
      grain: "x",
      color: P.woodDark,
      r: 0.02,
    }),
  );
  // cove step under the crown (built in its original order so every piece keeps its grain offset)
  const edge = woodPiece({
    size: [width + 0.12, 0.09, depth + 0.06],
    pos: [0, height + 0.04, midZ + 0.02],
    grain: "x",
    color: P.crown,
    r: 0.025,
  });
  parts.push(
    // chunky crown board
    woodPiece({
      size: [D.crownWidth, D.crownTop - height - 0.07, D.crownFrontZ - D.wallZ - 0.02],
      pos: [0, (D.crownTop + height + 0.07) / 2, (D.crownFrontZ + D.wallZ + 0.02) / 2],
      grain: "x",
      color: P.wood,
      r: 0.04,
      jitter: 0.02,
    }),
  );

  // stool: lathe seat, splayed legs, stretcher ring
  const [sx, , sz] = STOOL_POS;
  parts.push(
    prep(
      lathe(
        [
          [0, SEAT_TOP - 0.068],
          [0.25, SEAT_TOP - 0.068],
          [0.268, SEAT_TOP - 0.058],
          [0.276, SEAT_TOP - 0.034],
          [0.27, SEAT_TOP - 0.01],
          [0.252, SEAT_TOP],
          [0, SEAT_TOP],
        ],
        22,
      ),
      P.wood,
      { grain: "x", pos: [sx, 0, sz] },
    ),
  );
  const splay = 0.14;
  const seatUnder = SEAT_TOP - 0.068;
  for (let k = 0; k < 3; k++) {
    const phi = Math.PI / 2 + (k * Math.PI * 2) / 3 + 0.4;
    const rTop = 0.15;
    const rBot = rTop + seatUnder * Math.tan(splay);
    parts.push(
      prep(
        cylinderBetween(
          [sx + Math.cos(phi) * rTop, seatUnder + 0.01, sz + Math.sin(phi) * rTop],
          [sx + Math.cos(phi) * rBot, 0, sz + Math.sin(phi) * rBot],
          0.03,
          0.022,
          7,
        ),
        P.woodDark,
        { grain: "y" },
      ),
    );
  }
  const ringY = 0.2;
  parts.push(
    prep(new TorusGeometry(0.15 + (seatUnder - ringY) * Math.tan(splay), 0.011, 5, 24), P.woodDark, {
      grain: "x",
      pos: [sx, ringY, sz],
      rot: [Math.PI / 2, 0, 0],
    }),
  );

  return mergeGrouped([parts, [edge]]);
}

function buildStaticPaint(P: ExteriorPalette): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // nail for the EZ sign
  const [nx, ny, nz] = D.signNail;
  parts.push(
    prep(new CylinderGeometry(0.006, 0.006, 0.06, 6), P.nail, { pos: [nx, ny, nz + 0.03], rot: [Math.PI / 2, 0, 0] }),
    prep(new CylinderGeometry(0.016, 0.016, 0.008, 10), P.nail, {
      pos: [nx, ny, nz + 0.06],
      rot: [Math.PI / 2, 0, 0],
    }),
  );
  // terracotta pot + soil on the stool
  const [sx, , sz] = STOOL_POS;
  parts.push(
    prep(
      lathe(
        [
          [0, 0],
          [0.075, 0],
          [0.085, 0.008],
          [0.1, 0.13],
          [0.118, 0.132],
          [0.122, 0.17],
          [0.112, 0.176],
          [0.104, 0.172],
          [0.1, 0.15],
        ],
        18,
      ),
      P.terracotta,
      { pos: [sx, SEAT_TOP, sz] },
    ),
    prep(new CylinderGeometry(0.101, 0.101, 0.012, 16), P.soil, { pos: [sx, SEAT_TOP + 0.152, sz] }),
  );
  return merge(parts);
}

function buildPlant(P: ExteriorPalette): BufferGeometry {
  const [sx, , sz] = STOOL_POS;
  const base: Vec3 = [sx, SEAT_TOP + 0.158, sz];
  const parts: BufferGeometry[] = [];
  const greens = [P.leaf, P.leafDark, P.leafLight];
  // a plump upright rosette (the oval in the drawing)
  const leaves: { h: number; w: number; tilt: number; yaw: number }[] = [
    { h: 0.34, w: 0.06, tilt: 0.05, yaw: 0 },
    { h: 0.3, w: 0.055, tilt: 0.28, yaw: 0.3 },
    { h: 0.28, w: 0.055, tilt: 0.32, yaw: 1.6 },
    { h: 0.29, w: 0.055, tilt: 0.3, yaw: 2.8 },
    { h: 0.26, w: 0.05, tilt: 0.38, yaw: 4.0 },
    { h: 0.27, w: 0.05, tilt: 0.34, yaw: 5.2 },
    { h: 0.18, w: 0.045, tilt: 0.6, yaw: 0.9 },
    { h: 0.17, w: 0.045, tilt: 0.62, yaw: 3.4 },
  ];
  leaves.forEach((l, i) => {
    const lg = leaf(l.w, l.h, 0.02);
    lg.rotateX(l.tilt);
    lg.rotateY(l.yaw);
    parts.push(prep(lg, greens[i % 3], { jitter: 0.06, pos: base }));
  });
  // two long tendrils curling up and out like antennae
  for (const s of [-1, 1]) {
    const pts = [
      new Vector3(0, 0.18, 0),
      new Vector3(s * 0.05, 0.36, 0.01),
      new Vector3(s * 0.14, 0.5, 0.02),
      new Vector3(s * 0.24, 0.56, 0.03),
      new Vector3(s * 0.3, 0.53, 0.04),
    ].map((p) => p.add(new Vector3(...base)));
    const curve = new CatmullRomCurve3(pts);
    parts.push(prep(new TubeGeometry(curve, 16, 0.0065, 4, false), P.leafDark));
    // little leaves along the tendril
    [0.45, 0.75, 1].forEach((t, k) => {
      const p = curve.getPointAt(t);
      parts.push(
        prep(leaf(0.022, 0.07 - k * 0.008, 0.008), greens[(k + 1) % 3], {
          pos: [p.x, p.y, p.z],
          rot: [0.3, 0, s * (-0.9 - k * 0.35)],
        }),
      );
    });
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------------------------
// door (local space: x∈[0,W] from hinge inward, y∈[0,H], z∈[-T,0]); shared by both doors (right one mirrored)

export const KNOB_LOCAL: Vec3 = [D.door.width - 0.075, 1.25, 0];

/** Door leaf; group 0 = wood, group 1 = the mid-rail sill (an edge strip in glowing themes). */
function buildDoor(P: ExteriorPalette): BufferGeometry {
  const { width: W, height: H, thickness: T } = D.door;
  const parts: BufferGeometry[] = [];
  const outerStile = 0.1;
  const innerStile = 0.085;
  const spanL = outerStile;
  const spanR = W - innerStile;
  const spanW = spanR - spanL;
  const spanC = (spanL + spanR) / 2;
  const zc = -T / 2;
  parts.push(
    woodPiece({ size: [outerStile, H, T], pos: [outerStile / 2, H / 2, zc], grain: "y", color: P.wood, r: 0.012 }),
    woodPiece({ size: [innerStile, H, T], pos: [W - innerStile / 2, H / 2, zc], grain: "y", color: P.wood, r: 0.012 }),
    woodPiece({ size: [spanW + 0.02, 0.11, T * 0.94], pos: [spanC, H - 0.055, zc], grain: "x", color: P.wood, r: 0.01 }),
    woodPiece({ size: [spanW + 0.02, 0.13, T * 0.94], pos: [spanC, 0.065, zc], grain: "x", color: P.wood, r: 0.01 }),
    woodPiece({ size: [spanW + 0.02, 0.15, T * 0.94], pos: [spanC, 0.9, zc], grain: "x", color: P.wood, r: 0.01 }),
  );
  // the little ledge across the mid rail (drawn as a protruding sill)
  const sill = woodPiece({ size: [W - 0.02, 0.045, T + 0.045], pos: [W / 2, 0.99, -T + (T + 0.045) / 2], grain: "x", color: P.crown, r: 0.013 });
  // louvres
  const slat = (y0: number, y1: number) => {
    const pitch = 0.06;
    const n = Math.max(1, Math.round((y1 - y0) / pitch));
    const p = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      parts.push(
        woodPiece({
          size: [spanW + 0.012, 0.011, 0.07],
          pos: [spanC, y0 + p * (i + 0.5), zc],
          rot: [0.78, 0, 0],
          grain: "x",
          color: P.slat,
          r: 0,
          jitter: 0.04,
        }),
      );
    }
  };
  slat(1.015, H - 0.11);
  slat(0.13, 0.825);
  return mergeGrouped([parts, [sill]]);
}

function buildKnob(): BufferGeometry {
  const g = lathe(
    [
      [0, 0],
      [0.011, 0],
      [0.011, 0.016],
      [0.028, 0.026],
      [0.035, 0.04],
      [0.03, 0.054],
      [0.015, 0.06],
      [0, 0.061],
    ],
    14,
  );
  g.rotateX(Math.PI / 2);
  g.scale(1.25, 1.25, 1.1);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// "Grocer" letters

export type LetterLayout = { ch: string; geometry: BufferGeometry; x: number; halfW: number };

function buildLetters(P: ExteriorPalette, theme: SceneTheme): { letters: LetterLayout[]; z: number } {
  const size = D.lettersSize;
  const gap = 0.024;
  const geos = [...GROCER].map((ch) => {
    const g = textGeometry(ch, { size, depth: 0.12, bevel: 0.028, bevelSegments: 3, curveSegments: 5 }, theme);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    applyWoodUV(g, "y", ch.charCodeAt(0));
    tint(g, P.woodLight, 0.03, ch.charCodeAt(0));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return { ch, geometry: g as BufferGeometry, w: bb.max.x - bb.min.x };
  });
  let cursor = -1.19;
  const letters = geos.map(({ ch, geometry, w }) => {
    const x = cursor + w / 2;
    cursor += w + gap;
    return { ch, geometry, x, halfW: w / 2 };
  });
  return { letters, z: -0.2 };
}

// ---------------------------------------------------------------------------------------------------------------
// EZ sign (local space: origin at the nail; the sign group rotates about it)

/** Sign; group 0 = board (+ screw eyes, string), 1 = border strips, 2 = "EZ" lettering. */
function buildSign(P: ExteriorPalette, theme: SceneTheme): BufferGeometry {
  const pw = 0.62;
  const ph = 0.34;
  const pd = 0.045;
  const cy = -0.44;
  const cz = 0.04;
  const top = cy + ph / 2;
  const parts: BufferGeometry[] = [woodPiece({ size: [pw, ph, pd], pos: [0, cy, cz], grain: "x", color: P.wood, r: 0.018 })];
  // raised border frame for a crafted look
  const frame = [
    woodPiece({ size: [pw - 0.04, 0.02, 0.012], pos: [0, top - 0.035, cz + pd / 2 + 0.004], grain: "x", color: P.crown, r: 0.005 }),
    woodPiece({ size: [pw - 0.04, 0.02, 0.012], pos: [0, cy - ph / 2 + 0.035, cz + pd / 2 + 0.004], grain: "x", color: P.crown, r: 0.005 }),
  ];
  // "EZ" burned into a lighter plaque
  const ez = textGeometry("EZ", { size: 0.2, depth: 0.022, bevel: 0.006, bevelSegments: 2, curveSegments: 4 }, theme);
  ez.computeBoundingBox();
  const bb = ez.boundingBox!;
  ez.translate(-(bb.min.x + bb.max.x) / 2, cy - (bb.min.y + bb.max.y) / 2, cz + pd / 2 - 0.002 - bb.min.z);
  const text = prep(ez, P.ezText, { grain: "y" });
  // screw eyes + triangular string up to the nail
  const eyes: Vec3[] = [
    [-pw / 2 + 0.07, top + 0.004, cz],
    [pw / 2 - 0.07, top + 0.004, cz],
  ];
  for (const eye of eyes) {
    parts.push(prep(new TorusGeometry(0.012, 0.004, 4, 10), P.nail, { pos: [eye[0], eye[1] + 0.01, eye[2]] }));
    parts.push(prep(cylinderBetween([0, 0.004, 0.05], [eye[0], eye[1] + 0.018, eye[2]], 0.0035, 0.0035, 4), P.string));
  }
  return mergeGrouped([parts, frame, [text]]);
}

// ---------------------------------------------------------------------------------------------------------------
// paper shopping list (local space centred on the note, z = 0 at the pantry face)

const NOTE_W = D.note.width;
const NOTE_H = D.note.height;
export const NOTE_TRANSFORM = { pos: [D.note.x, D.note.y, D.note.z] as Vec3, rotZ: D.note.rotZ };
/** Pin head height above the note centre (the paper pivots / lifts off around it). */
export const NOTE_PIN_Y = NOTE_H / 2 - 0.03;

function buildPaper(): BufferGeometry {
  const g = new PlaneGeometry(NOTE_W, NOTE_H, 6, 12);
  const pos = g.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const xn = x / NOTE_W + 0.5;
    const yb = 0.5 - y / NOTE_H; // 0 top .. 1 bottom
    const curl = Math.max(0, (yb - 0.87) / 0.13);
    const z = 0.004 * Math.sin(Math.PI * xn) + 0.035 * curl * curl * (0.35 + 0.65 * xn);
    pos.setZ(i, z);
  }
  g.computeVertexNormals();
  return g;
}

function buildPin(P: ExteriorPalette): BufferGeometry {
  return merge([
    prep(new SphereGeometry(0.018, 10, 8), P.pin, { pos: [0, NOTE_PIN_Y, 0.028] }),
    prep(new CylinderGeometry(0.009, 0.013, 0.014, 10), P.pin, {
      pos: [0, NOTE_PIN_Y, 0.012],
      rot: [Math.PI / 2, 0, 0],
    }),
  ]);
}

const LIST_MAX_W = 0.18;

/**
 * A pinned paper's text: just its name ("List", "Me", "Week"), big enough to read from the closed-pantry view, with a
 * pencil squiggle under it. The details live on the paper's sheet (it opens when tapped), so the 3D paper stays legible.
 */
function buildPaperTitle(titleText: string, theme: SceneTheme): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const z = 0.0055;
  const size = 0.095;
  const title = textGeometry(titleText, { size, depth: 0.002, curveSegments: 4 }, theme);
  title.computeBoundingBox();
  const tb = title.boundingBox!;
  const w = tb.max.x - tb.min.x;
  const k = w > LIST_MAX_W ? LIST_MAX_W / w : 1; // "Week" in a wide theme font still fits the paper
  title.scale(k, k, 1);
  title.computeBoundingBox();
  const sb = title.boundingBox!;
  title.translate(-(sb.min.x + sb.max.x) / 2, -(sb.min.y + sb.max.y) / 2 + 0.03, z);
  parts.push(title);
  // squiggly underline (two short segments, slightly tilted)
  const uy = 0.03 - (sb.max.y - sb.min.y) / 2 - 0.022;
  parts.push(place(new BoxGeometry(0.075, 0.006, 0.0015).toNonIndexed(), [-0.036, uy, z], [0, 0, 0.06]));
  parts.push(place(new BoxGeometry(0.075, 0.006, 0.0015).toNonIndexed(), [0.038, uy, z], [0, 0, -0.06]));
  for (const p of parts) p.deleteAttribute("uv");
  for (const p of parts) p.setAttribute("uv", new BufferAttribute(new Float32Array(p.getAttribute("position").count * 2), 2));
  return merge(parts);
}

/** The List paper's text: "List" (the item lines were dropped so the paper reads at a glance). */
export function buildListText(_lines: string[], theme: SceneTheme = getActiveTheme()): BufferGeometry {
  return buildPaperTitle("List", theme);
}

/** The Week paper's text: "Week". */
export function buildWeekText(_lines: string[], theme: SceneTheme = getActiveTheme()): BufferGeometry {
  return buildPaperTitle("Week", theme);
}

/** The Me paper's text: "Me". */
export function buildMeText(_lines: string[], theme: SceneTheme = getActiveTheme()): BufferGeometry {
  return buildPaperTitle("Me", theme);
}

// ---------------------------------------------------------------------------------------------------------------

type Shared = {
  wood: BufferGeometry;
  paint: BufferGeometry;
  plant: BufferGeometry;
  door: BufferGeometry;
  knob: BufferGeometry;
  letters: LetterLayout[];
  lettersZ: number;
  sign: BufferGeometry;
  paper: BufferGeometry;
  pin: BufferGeometry;
  hit: BufferGeometry;
  noteHit: BufferGeometry;
  meHit: BufferGeometry;
  weekHit: BufferGeometry;
};

/** Theme-dependent geometry (vertex tints, theme font), keyed by theme id. */
const shared = new Map<string, Shared>();
let hitGeos: { hit: BufferGeometry; noteHit: BufferGeometry; meHit: BufferGeometry; weekHit: BufferGeometry } | null = null;

function disposeShared(s: Shared) {
  for (const g of [s.wood, s.paint, s.plant, s.door, s.knob, s.sign, s.paper, s.pin]) g.dispose();
  for (const l of s.letters) l.geometry.dispose();
}

export function getSharedGeometry(theme: SceneTheme = getActiveTheme()): Shared {
  const hit = shared.get(theme.id);
  if (hit) return hit;
  // Only one theme is on screen at a time: free the previous theme's geometry (three re-uploads it if still drawn).
  for (const [id, old] of shared) {
    disposeShared(old);
    shared.delete(id);
  }
  const P = exteriorPalette(theme);
  const box = (b: { size: Vec3 }) => new BoxGeometry(b.size[0], b.size[1], b.size[2]);
  hitGeos ??= { hit: new BoxGeometry(2.7, 4.2, 1.5), noteHit: box(NOTE_HIT), meHit: box(ME_HIT), weekHit: box(WEEK_HIT) };
  const { letters, z } = buildLetters(P, theme);
  const s: Shared = {
    wood: buildStaticWood(P),
    paint: buildStaticPaint(P),
    plant: buildPlant(P),
    door: buildDoor(P),
    knob: buildKnob(),
    letters,
    lettersZ: z,
    sign: buildSign(P, theme),
    paper: buildPaper(),
    pin: buildPin(P),
    hit: hitGeos.hit,
    noteHit: hitGeos.noteHit,
    meHit: hitGeos.meHit,
    weekHit: hitGeos.weekHit,
  };
  shared.set(theme.id, s);
  return s;
}

/** Tap target that covers the body, doors and letters generously. */
export const HIT_BOX = { position: [0, 2.1, -0.25] as Vec3 };
/**
 * Tap target for the pinned list: generously larger than the paper (about 1.8x wide) and deep enough that its front face
 * (z = 0.62) sits in front of HIT_BOX's (z = 0.5), so the nearest hit is always the note and the doors stay shut.
 */
export const NOTE_HIT = {
  position: [D.note.x + 0.02, D.note.y, 0.27] as Vec3,
  size: [0.44, 0.62, 0.7] as Vec3,
};
/** Tap target for the Me note: same depth as the list's, stacked directly below it (no overlap: y 1.45–1.79). */
export const ME_HIT = {
  position: [D.meNote.x + 0.02, 1.62, 0.27] as Vec3,
  size: [0.44, 0.34, 0.7] as Vec3,
};
/** Tap target for the Week note, below the door's mid-rail (y 0.64–1.08). */
export const WEEK_HIT = {
  position: [D.weekNote.x + 0.02, D.weekNote.y, 0.27] as Vec3,
  size: [0.44, 0.44, 0.7] as Vec3,
};

export type ExteriorHandles = {
  root: Group;
  leftDoor: Group;
  rightDoor: Group;
  letters: { mesh: Mesh; x: number; halfW: number }[];
  lettersZ: number;
  sign: Group;
  /** the paper (+ its text) that lifts off the pin; local frame = note centre, pivot at the note group */
  notePaper: Group;
  setListLines(lines: string[]): void;
  /** the Me note's paper (+ text), pinned below the list */
  mePaper: Group;
  setMeLines(lines: string[]): void;
  /** the Week note's paper (+ text), pinned below the Me note */
  weekPaper: Group;
  setWeekLines(lines: string[]): void;
  dispose(): void;
};

/** One material when every group would get the same one (one draw call), else a per-group material array. */
function groupMats(...mats: Material[]): Material | Material[] {
  return mats.every((m) => m === mats[0]) ? mats[0] : mats;
}

function mesh(geo: BufferGeometry, mat: Mesh["material"], cast = true, receive = true): Mesh {
  const m = new Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

export function createExterior(theme: SceneTheme = getActiveTheme()): ExteriorHandles {
  const g = getSharedGeometry(theme);
  const m = getMaterials(theme);
  const root = new Group();
  root.name = "PantryExterior";

  root.add(mesh(g.wood, groupMats(m.wood, m.edge)));
  root.add(mesh(g.paint, m.paint));
  root.add(mesh(g.plant, m.leaf, true, false));

  // doors: pivot groups at the hinge (front-outer corner), inner group mirrored for the right door
  const { hingeX, hingeZ, bottomY } = D.door;
  const makeDoor = (side: -1 | 1) => {
    const pivot = new Group();
    pivot.position.set(side * hingeX, bottomY, hingeZ);
    const inner = new Group();
    if (side === 1) inner.scale.x = -1;
    inner.add(mesh(g.door, groupMats(m.wood, m.doorEdge)));
    const knob = mesh(g.knob, m.knob, true, false);
    knob.position.set(...KNOB_LOCAL);
    inner.add(knob);
    pivot.add(inner);
    root.add(pivot);
    return pivot;
  };
  const leftDoor = makeDoor(-1);
  const rightDoor = makeDoor(1);

  const letters = g.letters.map((l) => {
    const lm = mesh(l.geometry, m.letters);
    lm.position.set(l.x, D.crownTop, g.lettersZ);
    root.add(lm);
    return { mesh: lm, x: l.x, halfW: l.halfW };
  });

  const sign = new Group();
  sign.position.set(...D.signNail);
  sign.add(mesh(g.sign, groupMats(m.wood, m.signFrame, m.signText), true, true));
  root.add(sign);

  const note = new Group();
  note.position.set(...NOTE_TRANSFORM.pos);
  note.rotation.z = NOTE_TRANSFORM.rotZ;
  // The pin stays in the stile; the paper + text live in their own group so they can lift off it.
  const notePaper = new Group();
  notePaper.add(mesh(g.paper, m.paper, false, true));
  const textMesh = mesh(new BufferGeometry(), m.ink, false, false);
  notePaper.add(textMesh);
  note.add(notePaper);
  note.add(mesh(g.pin, m.paint, true, false));
  root.add(note);

  // The Me and Week notes (spec §13): same paper and pin, their own text.
  const pinned = (n: { x: number; y: number; z: number; rotZ: number }) => {
    const group = new Group();
    group.position.set(n.x, n.y, n.z);
    group.rotation.z = n.rotZ;
    const paper = new Group();
    paper.add(mesh(g.paper, m.paper, false, true));
    const text = mesh(new BufferGeometry(), m.ink, false, false);
    paper.add(text);
    group.add(paper);
    group.add(mesh(g.pin, m.paint, true, false));
    root.add(group);
    return { paper, text };
  };
  const { paper: mePaper, text: meText } = pinned(D.meNote);
  const { paper: weekPaper, text: weekText } = pinned(D.weekNote);

  let lastKey = "";
  let lastMeKey = "";
  let lastWeekKey = "";
  return {
    root,
    leftDoor,
    rightDoor,
    letters,
    lettersZ: g.lettersZ,
    sign,
    notePaper,
    mePaper,
    weekPaper,
    setListLines(lines) {
      const key = lines.join("\n");
      if (key === lastKey) return;
      lastKey = key;
      textMesh.geometry.dispose();
      textMesh.geometry = buildListText(lines, theme);
    },
    setMeLines(lines) {
      const key = lines.join("\n");
      if (key === lastMeKey) return;
      lastMeKey = key;
      meText.geometry.dispose();
      meText.geometry = buildMeText(lines, theme);
    },
    setWeekLines(lines) {
      const key = lines.join("\n");
      if (key === lastWeekKey) return;
      lastWeekKey = key;
      weekText.geometry.dispose();
      weekText.geometry = buildWeekText(lines, theme);
    },
    dispose() {
      // Shared geometry/materials stay alive (module level). Only per-instance text is freed; safe to call twice
      // (React StrictMode re-runs effects), setListLines / setMeLines / setWeekLines rebuild it.
      textMesh.geometry.dispose();
      textMesh.geometry = new BufferGeometry();
      lastKey = "";
      meText.geometry.dispose();
      meText.geometry = new BufferGeometry();
      lastMeKey = "";
      weekText.geometry.dispose();
      weekText.geometry = new BufferGeometry();
      lastWeekKey = "";
    },
  };
}
