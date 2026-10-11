// Me station geometry: framed chalkboard "MY PICKS" with chalk tray, and a wall hook with an apron (cloth folds)
// carrying a polaroid of the user's initial. Static pieces are shared (module level); text is per instance.
import { BufferAttribute, type BufferGeometry, CircleGeometry, ExtrudeGeometry, PlaneGeometry, Shape, SphereGeometry } from "three";

import { APRON, ME_BOARD } from "../layout";
import { block, type Part, PartSet, prepPiece, rod, shade, stroke, text3d, tube, woodBlock } from "./common";

const W = ME_BOARD.w;
const H = ME_BOARD.h;
const FW = 0.05; // frame width
const FD = ME_BOARD.depth; // frame depth
const SLATE_Z = 0.024;

export const CHALK_PINK = "#F4B6C6";
export const MAX_PICKS = 3;

/** Avatar colours (white initials read on all of them). */
export const AVATAR_COLORS = ["#C8553D", "#3F7FBF", "#4E8F52", "#D9822B", "#8E5BB5", "#2E8C84"] as const;

/** Deterministic avatar colour for a name. Pure. */
export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** The pick lines shown in chalk: up to 3 non-empty, trimmed. Pure. */
export function pickLines(picks: readonly string[] | null | undefined): string[] {
  return (picks ?? [])
    .map((p) => (typeof p === "string" ? p.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_PICKS);
}

// ---------------------------------------------------------------------------------------------------------------
// chalkboard (local: centre of the board, back against the wall at z=0)

function heartShape(s: number): Shape {
  const h = new Shape();
  h.moveTo(0, -0.9 * s);
  h.bezierCurveTo(-1.3 * s, -0.1 * s, -0.75 * s, 0.95 * s, 0, 0.35 * s);
  h.bezierCurveTo(0.75 * s, 0.95 * s, 1.3 * s, -0.1 * s, 0, -0.9 * s);
  return h;
}

function buildBoard(): Part[] {
  const set = new PartSet();
  // frame
  set.add("wood", woodBlock([W, FW, FD], [0, H / 2 - FW / 2, FD / 2], { r: 0.012 }));
  set.add("wood", woodBlock([W, FW, FD], [0, -H / 2 + FW / 2, FD / 2], { r: 0.012 }));
  set.add("wood", woodBlock([FW, H - 2 * FW + 0.004, FD], [-W / 2 + FW / 2, 0, FD / 2], { r: 0.012, grain: "y" }));
  set.add("wood", woodBlock([FW, H - 2 * FW + 0.004, FD], [W / 2 - FW / 2, 0, FD / 2], { r: 0.012, grain: "y" }));
  set.add("woodDark", woodBlock([W - 0.02, H - 0.02, 0.012], [0, 0, 0.007], { r: 0.003 }));
  // slate (UV 0..1 across the board)
  const slate = new PlaneGeometry(W - 2 * FW + 0.01, H - 2 * FW + 0.01).toNonIndexed();
  slate.translate(0, 0, SLATE_Z);
  set.add("chalkboard", shade(slate, 0), { cast: false });
  // chalk tray + chalk + felt eraser
  const trayY = -H / 2 - 0.011;
  set.add("wood", woodBlock([W - 0.03, 0.022, 0.07], [0, trayY, 0.035], { r: 0.008 }));
  set.add("wood", woodBlock([W - 0.03, 0.016, 0.008], [0, trayY + 0.017, 0.066], { r: 0.003 }));
  const stickY = trayY + 0.011 + 0.0075;
  set.add("chalk", rod([0.1, stickY, 0.05], [0.178, stickY, 0.054], 0.0075, 8));
  set.add("chalk", rod([0.21, stickY, 0.046], [0.26, stickY, 0.05], 0.0075, 8), { overrides: { color: CHALK_PINK } });
  set.add("woodDark", woodBlock([0.11, 0.022, 0.04], [-0.22, trayY + 0.011 + 0.02, 0.046], { r: 0.006 }));
  set.add("cloth", block([0.112, 0.012, 0.041], [-0.22, trayY + 0.011 + 0.006, 0.046], { r: 0.004, perM: 30 }), { overrides: { color: "#7B7F86" } });
  // doodled heart in pink chalk (outline = heart minus a smaller heart)
  const outer = heartShape(0.042);
  outer.holes.push(heartShape(0.032));
  const heart = new ExtrudeGeometry(outer, { depth: 0.0012, bevelEnabled: false, curveSegments: 8 });
  set.add("chalk", prepPiece(heart, { pos: [W / 2 - FW - 0.065, -H / 2 + FW + 0.07, SLATE_Z], rot: [0, 0, -0.18], perM: 40 }), {
    overrides: { color: CHALK_PINK },
    cast: false,
  });
  // title "MY PICKS" + wavy underline
  const title = text3d("MY PICKS", { size: 0.062, align: "center", wobble: 0.06, seed: 3, depth: 0.0012 });
  if (title) set.add("chalk", prepPiece(title, { pos: [0, H / 2 - FW - 0.085, SLATE_Z], keepUV: true, jitter: 0 }), { cast: false });
  set.add("chalk", stroke([-0.17, H / 2 - FW - 0.102], [0.17, H / 2 - FW - 0.099], 0.007, SLATE_Z + 0.0006, 0.004), { cast: false });
  return set.build();
}

/** Chalk lines for the picks (or an inviting empty state). Board-local. */
export function buildPicksText(picks: readonly string[]): Part[] {
  const set = new PartSet();
  const lines = pickLines(picks);
  const left = -W / 2 + FW + 0.055;
  const maxW = W - 2 * FW - 0.2;
  const top = H / 2 - FW - 0.185;
  if (lines.length) {
    lines.forEach((line, i) => {
      const y = top - i * 0.088;
      const g = text3d(line, { size: 0.046, wobble: 0.05, seed: 11 + i * 5, maxW, minScale: 0.6, depth: 0.0012 });
      if (g) set.add("chalk", prepPiece(g, { pos: [left + 0.032, y, SLATE_Z], keepUV: true, jitter: 0 }), { cast: false });
      // chalk bullet dot
      const dot = new CircleGeometry(0.0085, 10);
      set.add("chalk", prepPiece(dot, { pos: [left + 0.008, y + 0.016, SLATE_Z + 0.0008], perM: 40, jitter: 0 }), { cast: false });
    });
  } else {
    const a = text3d("tap to add", { size: 0.042, wobble: 0.05, seed: 5, align: "center", depth: 0.0012 });
    const b = text3d("your faves!", { size: 0.042, wobble: 0.05, seed: 9, align: "center", depth: 0.0012 });
    if (a) set.add("chalk", prepPiece(a, { pos: [-0.04, top - 0.02, SLATE_Z], keepUV: true, jitter: 0 }), { cast: false });
    if (b) set.add("chalk", prepPiece(b, { pos: [-0.02, top - 0.105, SLATE_Z], keepUV: true, jitter: 0 }), { cast: false });
  }
  return set.build();
}

// ---------------------------------------------------------------------------------------------------------------
// hook + apron (local: hook point at the origin, wall at z = 0)

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Apron width at v (0 = top of bib .. 1 = hem). */
function apronWidth(v: number): number {
  const { bibW, skirtW, hemW } = APRON;
  const bib = bibW + 0.04 * smooth(0, 0.25, v);
  const toSkirt = smooth(0.24, 0.4, v);
  return bib + (skirtW - bib) * toSkirt + (hemW - skirtW) * smooth(0.4, 1, v);
}

/** Cloth surface offset from the wall at (u ∈ [-1,1] across, v down): resting folds deepening toward the hem. */
function apronZ(u: number, v: number): number {
  const base = 0.032 - 0.016 * smooth(0, 0.6, v);
  const amp = 0.003 + 0.017 * smooth(0.3, 1, v);
  const folds = 0.5 + 0.5 * Math.sin(u * Math.PI * 3.6 + 0.6 + v * 1.4);
  const belly = 0.006 * Math.sin(Math.PI * Math.min(1, v * 1.4)) * (1 - u * u);
  return base + amp * folds + belly;
}

/** Hem flare: x pushed out a little where folds bulge (reads as cloth). */
function apronPoint(u: number, v: number): [number, number, number] {
  const w = apronWidth(v);
  const y = APRON.top - v * APRON.length;
  const wave = 0.008 * smooth(0.5, 1, v) * Math.sin(u * Math.PI * 3.6 + 0.6 + v * 1.4);
  return [(u * w) / 2 + wave * u, y, apronZ(u, v)];
}

function clothGrid(cols: number, rows: number, at: (u: number, v: number) => [number, number, number], u0 = -1, u1 = 1, v0 = 0, v1 = 1): BufferGeometry {
  const g = new PlaneGeometry(1, 1, cols, rows);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const su = uv.getX(i);
    const sv = 1 - uv.getY(i);
    const [x, y, z] = at(u0 + (u1 - u0) * su, v0 + (v1 - v0) * sv);
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  // cloth UVs in metres-ish (weave scale)
  const p2 = g.getAttribute("position");
  const uvs = new Float32Array(p2.count * 2);
  for (let i = 0; i < p2.count; i++) {
    uvs[i * 2] = p2.getX(i) * 6;
    uvs[i * 2 + 1] = p2.getY(i) * 6;
  }
  g.setAttribute("uv", new BufferAttribute(uvs, 2));
  return prepPiece(g, { keepUV: true, jitter: 0 });
}

const POCKET = { u: 0.56, v0: 0.56, v1: 0.74 };

function buildApron(): Part[] {
  const set = new PartSet();
  // backplate + brass hook with a ball tip
  set.add("woodDark", woodBlock([0.07, 0.11, 0.018], [0, 0.0, 0.009], { r: 0.006, grain: "y" }));
  set.add(
    "metal",
    tube(
      [
        [0, -0.01, 0.016],
        [0, -0.012, 0.04],
        [0, -0.004, 0.062],
        [0, 0.018, 0.07],
        [0, 0.034, 0.064],
      ],
      0.0055,
      14,
      6,
    ),
    { overrides: { color: "#C9A04E" } },
  );
  set.add("metal", prepPiece(new SphereGeometry(0.009, 10, 8), { pos: [0, 0.036, 0.062] }), { overrides: { color: "#C9A04E" } });
  // neck strap looping over the hook down to the bib corners
  const topY = APRON.top;
  const bib = apronWidth(0) / 2;
  for (const s of [-1, 1]) {
    set.add(
      "cloth",
      tube(
        [
          [0, 0.004, 0.058],
          [s * 0.03, -0.03, 0.05],
          [s * (bib - 0.03), topY + 0.04, 0.036],
          [s * (bib - 0.012), topY + 0.004, 0.033],
        ],
        0.0075,
        12,
        5,
      ),
    );
  }
  // body (bib → skirt) with folds
  set.add("cloth", clothGrid(14, 30, apronPoint));
  // top hem band
  set.add("cloth", block([apronWidth(0) + 0.004, 0.014, 0.008], [0, topY - 0.004, apronZ(0, 0) + 0.002], { r: 0.003, perM: 30 }), {
    overrides: { color: "#4C7A4C" },
  });
  // waist ties hanging at the sides
  const waistV = 0.4;
  const waistY = topY - waistV * APRON.length;
  for (const s of [-1, 1]) {
    const x0 = (s * apronWidth(waistV)) / 2;
    set.add(
      "cloth",
      clothGrid(
        2,
        10,
        (u, v) => [x0 + s * (0.01 + 0.02 * Math.sin(v * 2.5)) + u * 0.016, waistY - v * 0.36, 0.022 + 0.008 * Math.sin(v * 4 + s)],
        -1,
        1,
        0,
        1,
      ),
      { overrides: { color: "#4C7A4C" } },
    );
  }
  // cream pocket following the folds, with a stitched top band
  const pocket = (u: number, v: number): [number, number, number] => {
    const p = apronPoint(u, v);
    return [p[0], p[1], p[2] + 0.0035];
  };
  set.add("cloth", clothGrid(8, 6, pocket, -POCKET.u, POCKET.u, POCKET.v0, POCKET.v1), { overrides: { color: "#F2E6CF" } });
  set.add(
    "cloth",
    clothGrid(8, 1, (u, v) => {
      const p = apronPoint(u, v);
      return [p[0], p[1], p[2] + 0.0045];
    }, -POCKET.u, POCKET.u, POCKET.v0, POCKET.v0 + 0.018),
    { overrides: { color: "#D9C7A6" } },
  );
  // pocket divider stitch
  const mid = apronPoint(0, (POCKET.v0 + POCKET.v1) / 2);
  set.add("ink", block([0.003, (POCKET.v1 - POCKET.v0 - 0.03) * APRON.length, 0.001], [0, mid[1] - 0.008, mid[2] + 0.0045], { r: 0 }), {
    overrides: { color: "#B9A27C" },
    cast: false,
  });
  return set.build();
}

// ---------------------------------------------------------------------------------------------------------------
// polaroid (local: centre of the photo card, back at z = 0); shared by the Me station and the cork board

export const POLAROID = { w: 0.15, h: 0.18, photo: 0.126, photoY: 0.016, depth: 0.004 } as const;

/** Polaroid with a coloured avatar circle + initial, and the name written under the photo. */
export function buildPolaroid(initial: string, name: string, color: string, scale = 1): Part[] {
  const set = new PartSet();
  const s = scale;
  const P = POLAROID;
  set.add("paper", block([P.w * s, P.h * s, P.depth], [0, 0, P.depth / 2], { r: 0.0015, perM: 6 }));
  const photo = new PlaneGeometry(P.photo * s, P.photo * s).toNonIndexed();
  set.add("paper", prepPiece(photo, { pos: [0, P.photoY * s, P.depth + 0.0004], jitter: 0 }), { overrides: { color: "#DCE7EC" }, cast: false });
  const circle = new CircleGeometry(0.047 * s, 28);
  set.add("paper", prepPiece(circle, { pos: [0, P.photoY * s, P.depth + 0.0009], jitter: 0 }), { overrides: { color }, cast: false });
  const letter = (initial || name || "?").trim().charAt(0).toUpperCase() || "?";
  const ig = text3d(letter, { size: 0.05 * s, align: "center", depth: 0.001 });
  if (ig) {
    ig.computeBoundingBox();
    const bb = ig.boundingBox!;
    set.add("paper", prepPiece(ig, { pos: [-(bb.min.x + bb.max.x) / 2, P.photoY * s - (bb.min.y + bb.max.y) / 2, P.depth + 0.0012], keepUV: true, jitter: 0 }), {
      overrides: { color: "#FFFFFF" },
      cast: false,
    });
  }
  const ng = text3d(name, { size: 0.022 * s, align: "center", wobble: 0.03, seed: name.length + 1, maxW: (P.w - 0.02) * s, minScale: 0.6, depth: 0.0008 });
  if (ng) set.add("ink", prepPiece(ng, { pos: [0, (-P.h / 2 + 0.017) * s, P.depth + 0.0003], keepUV: true, jitter: 0 }), { cast: false });
  return set.build();
}

/** Small wooden clothespin (local: centre of the clip, pointing down onto the card top). */
function buildClothespin(): Part[] {
  const set = new PartSet();
  set.add("wood", woodBlock([0.016, 0.06, 0.007], [0, 0, 0.0035], { r: 0.0025, grain: "y" }));
  set.add("wood", woodBlock([0.016, 0.06, 0.007], [0, 0, 0.0115], { r: 0.0025, grain: "y" }));
  set.add("metal", rod([-0.009, 0.006, 0.0075], [0.009, 0.006, 0.0075], 0.0022, 6));
  return set.build();
}

// ---------------------------------------------------------------------------------------------------------------

type MeShared = { board: Part[]; apron: Part[]; clothespin: Part[] };
let shared: MeShared | null = null;

export function getMeShared(): MeShared {
  shared ??= { board: buildBoard(), apron: buildApron(), clothespin: buildClothespin() };
  return shared;
}

/** Where the polaroid hangs on the apron bib (hook-local). */
export const APRON_POLAROID = { pos: [0.004, APRON.top - 0.15, 0.036] as [number, number, number], rotZ: 0.07 };

