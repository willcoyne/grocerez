// Recipe books on a small wooden wall shelf (shelf-local: centre of the shelf's top surface at the wall, z = 0 at the
// wall, +z toward the room). Three cloth-bound books stacked flat (the middle one askew, an index card peeking out),
// a fourth standing and leaning on the stack, ribbon bookmarks.
import { type BufferGeometry, ExtrudeGeometry, Shape } from "three";

import { BOOK_SHELF } from "../layout";
import { block, type Part, PartSet, prepPiece, text3d, woodBlock, type Vec3 } from "./common";

const SW = BOOK_SHELF.w;
const SD = BOOK_SHELF.depth;
const ST = 0.03;

export const BOOK_COLORS = ["#8E3B2F", "#2F5D50", "#C9A227", "#3B4F7A"] as const;
const RIBBON_COLORS = ["#C9A227", "#B33A3A", "#2F5D50", "#E0C27A"] as const;

type BookSpec = { w: number; d: number; t: number; color: string; title: string; ribbon: string };

/**
 * One book lying flat, spine toward +z (book-local: centre of its bottom face at the origin), yawed and placed.
 * w = width along x, d = depth (front-to-back), t = thickness.
 */
function addBook(set: PartSet, b: BookSpec, pos: Vec3, rotY: number) {
  const board = 0.004;
  const put = (g: BufferGeometry) => {
    g.rotateY(rotY);
    g.translate(pos[0], pos[1], pos[2]);
    return g;
  };
  const piece = (size: Vec3, p: Vec3) => put(block(size, p, { r: Math.min(0.0025, size[1] / 3), perM: 12 }));
  const ov = { color: b.color };
  // covers + spine
  set.add("bookCloth", piece([b.w, board, b.d], [0, board / 2, 0]), { overrides: ov });
  set.add("bookCloth", piece([b.w, board, b.d], [0, b.t - board / 2, 0]), { overrides: ov });
  set.add("bookCloth", piece([b.w, b.t, board * 1.6], [0, b.t / 2, b.d / 2 - board * 0.8]), { overrides: ov });
  // page block, inset on three sides
  set.add("bookPage", piece([b.w - 0.01, b.t - 2 * board, b.d - 0.008], [0, b.t / 2, -0.002]));
  // spine bands + title
  for (const dx of [-b.w * 0.42, b.w * 0.42]) {
    set.add("metal", piece([0.0018, b.t * 0.78, 0.0008], [dx, b.t / 2, b.d / 2 + 0.0004]), { overrides: { color: "#D8B25C" }, cast: false });
  }
  const g = text3d(b.title, { size: Math.min(0.02, b.t * 0.42), align: "center", depth: 0.0008, maxW: b.w * 0.7 });
  if (g) {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const tg = prepPiece(g, { pos: [0, b.t / 2 - (bb.min.y + bb.max.y) / 2, b.d / 2 + 0.0002], keepUV: true, jitter: 0 });
    set.add("paper", put(tg), { overrides: { color: "#F6E7C1" }, cast: false });
  }
  // ribbon bookmark spilling out of the right edge (head) and drooping over the side
  set.add("cloth", piece([0.03, 0.0012, 0.009], [b.w / 2 + 0.012, b.t * 0.55, b.d * 0.2]), { overrides: { color: b.ribbon }, cast: false });
  set.add("cloth", piece([0.0012, b.t * 0.55 + 0.02, 0.009], [b.w / 2 + 0.027, b.t * 0.3 - 0.008, b.d * 0.2]), { overrides: { color: b.ribbon }, cast: false });
}

function buildShelf(set: PartSet) {
  set.add("wood", woodBlock([SW, ST, SD], [0, -ST / 2, SD / 2], { r: 0.008 }));
  // little front lip
  set.add("wood", woodBlock([SW, 0.012, 0.012], [0, 0.004, SD - 0.006], { r: 0.004 }));
  // triangular brackets
  const tri = new Shape();
  tri.moveTo(0, 0);
  tri.lineTo(SD - 0.03, 0);
  tri.quadraticCurveTo(SD * 0.35, -0.04, 0, -0.13);
  tri.lineTo(0, 0);
  for (const x of [-SW / 2 + 0.07, SW / 2 - 0.07]) {
    const g = new ExtrudeGeometry(tri, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 6 });
    // shape is in (z, y); extruded along x
    g.rotateY(-Math.PI / 2);
    g.translate(x + 0.01, -ST, 0);
    set.add("woodDark", prepPiece(g, { perM: 1.7 }));
  }
}

function buildBooks(): Part[] {
  const set = new PartSet();
  buildShelf(set);
  const stack: BookSpec[] = [
    { w: 0.29, d: 0.17, t: 0.05, color: BOOK_COLORS[0], title: "FAMILY", ribbon: RIBBON_COLORS[0] },
    { w: 0.26, d: 0.155, t: 0.04, color: BOOK_COLORS[1], title: "SOUPS", ribbon: RIBBON_COLORS[1] },
    { w: 0.23, d: 0.145, t: 0.045, color: BOOK_COLORS[2], title: "BAKING", ribbon: RIBBON_COLORS[2] },
  ];
  const sx = -0.07;
  let y = 0;
  const yaws = [0.03, -0.17, 0.08];
  stack.forEach((b, i) => {
    addBook(set, b, [sx + (i === 1 ? 0.012 : 0), y, SD / 2 - 0.005 + (i === 1 ? 0.01 : 0)], yaws[i]);
    if (i === 1) {
      // index card peeking out of the askew book's left side
      const card = block([0.1, 0.0015, 0.075], [0, 0, 0], { r: 0, perM: 8 });
      card.rotateY(0.25);
      card.translate(sx - b.w / 2 - 0.012, y + b.t * 0.5, SD / 2 - 0.01);
      set.add("paper", card, { overrides: { color: "#FFFDF6" } });
      const line = block([0.028, 0.0006, 0.004], [0, 0, 0], { r: 0 });
      line.rotateY(0.25);
      line.translate(sx - b.w / 2 - 0.042, y + b.t * 0.5 + 0.001, SD / 2 + 0.014);
      set.add("ink", line, { overrides: { color: "#D9534F" }, cast: false });
    }
    y += b.t;
  });
  // fourth book standing upright, leaning on the stack
  addStanding(set, { w: 0.26, d: 0.16, t: 0.045, color: BOOK_COLORS[3], title: "PASTA", ribbon: RIBBON_COLORS[3] });
  return set.build();
}

const LEAN = 0.2;
const STAND_X = 0.1;

/** Book modelled on its side (x = height 0..w, y = thickness 0..t, spine at +z) → standing, leaning left. */
function standingTransform(g: BufferGeometry, t: number) {
  g.rotateZ(Math.PI / 2); // height up; thickness now runs toward -x
  g.translate(t, 0, 0); // pivot = bottom-left edge
  g.rotateZ(LEAN);
  g.translate(STAND_X, 0, BOOK_SHELF.depth / 2 - 0.005);
  return g;
}

function addStanding(set: PartSet, b: BookSpec) {
  const board = 0.004;
  const ov = { color: b.color };
  const mk = (size: Vec3, p: Vec3, r = 0.002) => standingTransform(block(size, p, { r, perM: 12 }), b.t);
  set.add("bookCloth", mk([b.w, board, b.d], [b.w / 2, board / 2, 0]), { overrides: ov });
  set.add("bookCloth", mk([b.w, board, b.d], [b.w / 2, b.t - board / 2, 0]), { overrides: ov });
  set.add("bookCloth", mk([b.w, b.t, board * 1.6], [b.w / 2, b.t / 2, b.d / 2 - board * 0.8]), { overrides: ov });
  set.add("bookPage", mk([b.w - 0.008, b.t - 2 * board, b.d - 0.008], [b.w / 2 - 0.002, b.t / 2, -0.002], 0.001));
  for (const dx of [0.03, b.w - 0.03]) {
    set.add("metal", mk([0.0018, b.t * 0.78, 0.0008], [dx, b.t / 2, b.d / 2 + 0.0004], 0), { overrides: { color: "#D8B25C" }, cast: false });
  }
  const g = text3d(b.title, { size: 0.019, align: "center", depth: 0.0008, maxW: b.w * 0.6 });
  if (g) {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const tg = prepPiece(g, { pos: [b.w / 2, b.t / 2 - (bb.min.y + bb.max.y) / 2, b.d / 2 + 0.0002], keepUV: true, jitter: 0 });
    set.add("paper", standingTransform(tg, b.t), { overrides: { color: "#F6E7C1" }, cast: false });
  }
  // ribbon hanging out of the top, down the spine
  set.add("cloth", mk([0.07, 0.009, 0.0012], [b.w - 0.012, b.t * 0.62, b.d / 2 + 0.002], 0), { overrides: { color: b.ribbon }, cast: false });
}

let shared: Part[] | null = null;
export function getBooksShared(): Part[] {
  shared ??= buildBooks();
  return shared;
}
