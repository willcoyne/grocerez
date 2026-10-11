// Household station geometry: framed cork board with member polaroids (taped), invite postcards, an alert slip held by
// red pushpins + a red count badge, and a recipe index card. Board-local: centre of the board, wall at z = 0.
import { BufferAttribute, CylinderGeometry, LatheGeometry, PlaneGeometry, TorusGeometry, Vector2 } from "three";

import { CORK_BOARD } from "../layout";
import { block, type Part, PartSet, prepPiece, shade, stroke, text3d, woodBlock, type Vec3 } from "./common";
import { AVATAR_COLORS, avatarColor, buildPolaroid, POLAROID } from "./me";

const W = CORK_BOARD.w;
const H = CORK_BOARD.h;
const FW = 0.06;
const FD = CORK_BOARD.depth;
export const CORK_Z = 0.03;

export const MAX_MEMBERS = 5;
export const MAX_POSTCARDS = 3;
export const MAX_ALERT_PINS = 3;
const POLAROID_SCALE = 1.2;

export type Member = { name: string; initial: string };

/** Member polaroid slots: centre x, y, tilt (board-local). */
export const MEMBER_SLOTS: readonly [number, number, number][] = [
  [-0.45, 0.17, 0.08],
  [-0.23, 0.19, -0.06],
  [-0.01, 0.16, 0.05],
  [-0.36, -0.17, -0.045],
  [-0.13, -0.16, 0.085],
];
const TAPE_COLORS = ["#A8D8C8", "#F5C6A5", "#C9B8E8", "#F3E19A", "#B8D4F0"];
const RECIPE = { x: 0.36, y: 0.22, w: 0.26, h: 0.16, rot: -0.05 };
const POSTCARD = { x: 0.33, y: -0.13, w: 0.24, h: 0.155 };
const SLIP = { x: 0.1, y: -0.235, size: 0.12, rot: 0.06 };
/** Count badge on the frame's top-right corner. */
export const BADGE = { x: W / 2 - 0.035, y: H / 2 - 0.035, z: FD + 0.002, r: 0.05 };

/** Badge text for an alert count. Pure. */
export function badgeLabel(count: number): string {
  const n = Math.max(0, Math.floor(count));
  return n > 9 ? "9+" : String(n);
}

/** Visible counts for the data (pure; used by tests and the builder). */
export function householdCounts(members: readonly Member[], inviteCount: number, alertCount: number) {
  return {
    polaroids: Math.min(MAX_MEMBERS, members.length),
    postcards: Math.min(MAX_POSTCARDS, Math.max(0, Math.floor(inviteCount))),
    pins: Math.min(MAX_ALERT_PINS, Math.max(0, Math.floor(alertCount))),
    badge: Math.max(0, Math.floor(alertCount)) > 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------

function buildFrame(): Part[] {
  const set = new PartSet();
  set.add("wood", woodBlock([W, FW, FD], [0, H / 2 - FW / 2, FD / 2], { r: 0.014 }));
  set.add("wood", woodBlock([W, FW, FD], [0, -H / 2 + FW / 2, FD / 2], { r: 0.014 }));
  set.add("wood", woodBlock([FW, H - 2 * FW + 0.004, FD], [-W / 2 + FW / 2, 0, FD / 2], { r: 0.014, grain: "y" }));
  set.add("wood", woodBlock([FW, H - 2 * FW + 0.004, FD], [W / 2 - FW / 2, 0, FD / 2], { r: 0.014, grain: "y" }));
  set.add("woodDark", woodBlock([W - 0.02, H - 0.02, 0.014], [0, 0, 0.008], { r: 0.003 }));
  // cork: UVs at 2 tiles per metre
  const cork = new PlaneGeometry(W - 2 * FW + 0.012, H - 2 * FW + 0.012).toNonIndexed();
  const pos = cork.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 2;
    uv[i * 2 + 1] = pos.getY(i) * 2;
  }
  cork.setAttribute("uv", new BufferAttribute(uv, 2));
  cork.translate(0, 0, CORK_Z);
  set.add("cork", shade(cork, 0), { cast: false });
  return set.build();
}

/** Pushpin standing on the surface at `p` (pointing +z): plastic head + collar, metal needle. */
function pushpin(set: PartSet, p: Vec3, role: "pin" | "metal", color?: string) {
  const prof = [
    [0, 0.024],
    [0.011, 0.024],
    [0.0135, 0.021],
    [0.0135, 0.016],
    [0.007, 0.0145],
    [0.0055, 0.006],
    [0.0085, 0.0035],
    [0.0085, 0.002],
    [0, 0.002],
  ].map(([r, y]) => new Vector2(r, y));
  const g = new LatheGeometry(prof, 14);
  g.computeVertexNormals();
  set.add(role, prepPiece(g, { pos: p, rot: [Math.PI / 2, 0, 0] }), color ? { overrides: { color } } : {});
  set.add("metal", prepPiece(new CylinderGeometry(0.0012, 0.0012, 0.004, 5), { pos: [p[0], p[1], p[2] + 0.001], rot: [Math.PI / 2, 0, 0] }));
}

/** Flat metal thumbtack. */
function tack(set: PartSet, p: Vec3) {
  set.add("metal", prepPiece(new CylinderGeometry(0.011, 0.012, 0.003, 14), { pos: [p[0], p[1], p[2] + 0.0015], rot: [Math.PI / 2, 0, 0] }));
  set.add("metal", prepPiece(new CylinderGeometry(0.0035, 0.004, 0.004, 8), { pos: [p[0], p[1], p[2] + 0.004], rot: [Math.PI / 2, 0, 0] }));
}

/** Rotate a board-local offset (dx, dy) by `rot` around (cx, cy). */
function at(cx: number, cy: number, rot: number, dx: number, dy: number, z: number): Vec3 {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c, z];
}

function buildRecipeCard(set: PartSet) {
  const { x, y, w, h, rot } = RECIPE;
  const z = CORK_Z + 0.0015;
  set.add("paper", block([w, h, 0.002], [x, y, z], { rot: [0, 0, rot], r: 0.001, perM: 6 }), { overrides: { color: "#FFFDF6" } });
  const line = (dy: number, color: string, width: number) =>
    set.add("ink", block([w - 0.03, width, 0.0006], at(x, y, rot, 0, dy, z + 0.0013), { rot: [0, 0, rot], r: 0 }), { overrides: { color }, cast: false });
  line(0.035, "#D9534F", 0.003);
  for (const dy of [0.005, -0.022, -0.049]) line(dy, "#8DB3D9", 0.0018);
  const title = text3d("RECIPE", { size: 0.026, depth: 0.0008 });
  if (title) set.add("ink", prepPiece(title, { pos: at(x, y, rot, -w / 2 + 0.018, 0.045, z + 0.0012), rot: [0, 0, rot], keepUV: true, jitter: 0 }), { cast: false });
  // a few handwritten squiggles on the rules
  for (const [dy, len] of [[0.009, 0.15], [-0.018, 0.11], [-0.045, 0.17]] as const) {
    const a = at(x, y, rot, -w / 2 + 0.02, dy, 0);
    const b = at(x, y, rot, -w / 2 + 0.02 + len, dy, 0);
    set.add("ink", stroke([a[0], a[1]], [b[0], b[1]], 0.003, z + 0.0016, 0.0025, 0.0006), { cast: false });
  }
  tack(set, at(x, y, rot, w / 2 - 0.022, h / 2 - 0.018, z + 0.001));
}

function buildPostcards(set: PartSet, n: number, invites: number) {
  const { x, y, w, h } = POSTCARD;
  for (let i = n - 1; i >= 0; i--) {
    const rot = 0.07 - i * 0.09;
    const cx = x + i * 0.022;
    const cy = y + i * 0.018;
    const z = CORK_Z + 0.0015 + (n - 1 - i) * 0.0026;
    set.add("paper", block([w, h, 0.002], [cx, cy, z], { rot: [0, 0, rot], r: 0.001, perM: 6 }), { overrides: { color: "#F6EBD6" } });
    if (i !== 0) continue;
    const fz = z + 0.0013;
    // stamp (white scalloped border look = border + inner square)
    set.add("paper", block([0.046, 0.054, 0.0007], at(cx, cy, rot, w / 2 - 0.035, h / 2 - 0.037, fz), { rot: [0, 0, rot], r: 0 }), { overrides: { color: "#FFFFFF" }, cast: false });
    set.add("paper", block([0.036, 0.044, 0.0007], at(cx, cy, rot, w / 2 - 0.035, h / 2 - 0.037, fz + 0.0006), { rot: [0, 0, rot], r: 0 }), { overrides: { color: "#6FA8DC" }, cast: false });
    // divider + address lines
    set.add("ink", block([0.0018, h - 0.04, 0.0006], at(cx, cy, rot, 0.012, 0, fz), { rot: [0, 0, rot], r: 0 }), { cast: false });
    for (const dy of [-0.012, -0.034, -0.056]) {
      set.add("ink", block([0.08, 0.0016, 0.0006], at(cx, cy, rot, 0.07, dy, fz), { rot: [0, 0, rot], r: 0 }), { overrides: { color: "#8A8378" }, cast: false });
    }
    const t1 = text3d(invites === 1 ? "INVITE" : "INVITES", { size: 0.024, depth: 0.0008, maxW: 0.1 });
    if (t1) set.add("ink", prepPiece(t1, { pos: at(cx, cy, rot, -w / 2 + 0.014, 0.022, fz), rot: [0, 0, rot], keepUV: true, jitter: 0 }), { cast: false });
    const t2 = text3d(`${invites} pending`, { size: 0.019, depth: 0.0008, maxW: 0.1, wobble: 0.03, seed: invites });
    if (t2) set.add("ink", prepPiece(t2, { pos: at(cx, cy, rot, -w / 2 + 0.014, -0.012, fz), rot: [0, 0, rot], keepUV: true, jitter: 0 }), { overrides: { color: "#3F6FB0" }, cast: false });
    tack(set, at(cx, cy, rot, -0.02, h / 2 - 0.014, fz));
  }
}

function buildAlertSlip(set: PartSet, pins: number) {
  const { x, y, size, rot } = SLIP;
  const z = CORK_Z + 0.0015;
  set.add("paper", block([size, size, 0.0018], [x, y, z], { rot: [0, 0, rot], r: 0.001, perM: 6 }), { overrides: { color: "#FFE58A" } });
  const bang = text3d("!", { size: 0.062, align: "center", depth: 0.001 });
  if (bang) set.add("ink", prepPiece(bang, { pos: at(x, y, rot, 0, -0.045, z + 0.0012), rot: [0, 0, rot], keepUV: true, jitter: 0 }), { overrides: { color: "#B3261E" }, cast: false });
  const spots: [number, number][] = [
    [0, 0.046],
    [-0.038, 0.044],
    [0.038, 0.042],
  ];
  for (let i = 0; i < pins; i++) pushpin(set, at(x, y, rot, spots[i][0], spots[i][1], z + 0.001), "pin");
}

/** Everything on the board that depends on data (board-local). */
export function buildHouseholdContent(members: readonly Member[], inviteCount: number, alertCount: number): Part[] {
  const set = new PartSet();
  const counts = householdCounts(members, inviteCount, alertCount);
  buildRecipeCard(set);
  if (counts.postcards) buildPostcards(set, counts.postcards, Math.max(0, Math.floor(inviteCount)));
  if (counts.pins) buildAlertSlip(set, counts.pins);
  const parts = set.build();
  // polaroids (own parts so each keeps its avatar colour), each taped at the top
  const tape = new PartSet();
  const used = new Set<string>();
  for (let i = 0; i < counts.polaroids; i++) {
    const m = members[i];
    const [sx, sy, rot] = MEMBER_SLOTS[i];
    const z = CORK_Z + 0.001;
    // each member's own colour, nudged to the next free one so two members never look alike on the board
    let color = avatarColor(m.name || m.initial);
    for (let k = 0; k < AVATAR_COLORS.length && used.has(color); k++) color = AVATAR_COLORS[(AVATAR_COLORS.indexOf(color as (typeof AVATAR_COLORS)[number]) + 1) % AVATAR_COLORS.length];
    used.add(color);
    const card = buildPolaroid(m.initial, m.name, color, POLAROID_SCALE);
    for (const p of card) {
      p.geometry.rotateZ(rot);
      p.geometry.translate(sx, sy, z);
      parts.push(p);
    }
    const ty = (POLAROID.h / 2) * POLAROID_SCALE - 0.004;
    tape.add("paper", block([0.075, 0.026, 0.0012], at(sx, sy, rot, 0.006 * (i % 2 ? 1 : -1), ty, z + POLAROID.depth + 0.0008), { rot: [0, 0, rot + (i % 2 ? 0.12 : -0.1)], r: 0 }), {
      overrides: { color: TAPE_COLORS[i % TAPE_COLORS.length] },
      cast: false,
    });
  }
  parts.push(...tape.build());
  return parts;
}

/** Red count badge (badge-local: centre of the disc, back at z = 0). */
export function buildBadge(count: number): Part[] {
  const set = new PartSet();
  const r = BADGE.r;
  set.add("pin", prepPiece(new CylinderGeometry(r, r, 0.014, 28), { pos: [0, 0, 0.007], rot: [Math.PI / 2, 0, 0] }));
  set.add("paper", prepPiece(new TorusGeometry(r - 0.004, 0.0045, 6, 32), { pos: [0, 0, 0.0145] }), { overrides: { color: "#FFFFFF" } });
  const label = badgeLabel(count);
  const g = text3d(label, { size: label.length > 1 ? 0.036 : 0.044, align: "center", depth: 0.002 });
  if (g) {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    set.add("paper", prepPiece(g, { pos: [-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, 0.0142], keepUV: true, jitter: 0 }), { overrides: { color: "#FFFFFF" }, cast: false });
  }
  return set.build();
}

let frame: Part[] | null = null;
export function getHouseholdFrame(): Part[] {
  frame ??= buildFrame();
  return frame;
}
