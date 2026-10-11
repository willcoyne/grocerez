// Meal-prep wall calendar (paper-local: centre of the sheet, z = 0 at the pantry face). Accent header "MEAL PREP",
// month name, weekday initials, 5x7 day grid; this week gets doodled meal icons / check marks, today is circled.
import { BufferAttribute, type BufferGeometry, CircleGeometry, CylinderGeometry, PlaneGeometry, TorusGeometry } from "three";

import { CALENDAR } from "../layout";
import { block, type Part, PartSet, prepPiece, stroke, text3d } from "./common";

const W = CALENDAR.width;
const H = CALENDAR.height;
const GRID = { left: -W / 2 + 0.012, right: W / 2 - 0.012, top: H / 2 - 0.118, rowH: 0.036 };
const CELL_W = (GRID.right - GRID.left) / 7;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type GridCell = { day: number; col: number; row: number };

/**
 * 5x7 month grid (Sunday first) for the month containing `today`. Days that would need a 6th row wrap into the empty
 * cells of the first row, as printed wall calendars do. Pure.
 */
export function monthGrid(today: Date): { cells: GridCell[]; today: GridCell; weekRow: number; monthIndex: number } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: GridCell[] = [];
  for (let d = 1; d <= days; d++) {
    let idx = first + d - 1;
    if (idx >= 35) idx -= 35;
    cells.push({ day: d, col: idx % 7, row: Math.floor(idx / 7) });
  }
  const t = cells[today.getDate() - 1];
  return { cells, today: t, weekRow: t.row, monthIndex: m };
}

export function defaultMonthLabel(today: Date): string {
  return MONTHS[today.getMonth()];
}

function cellCenter(col: number, row: number): [number, number] {
  return [GRID.left + CELL_W * (col + 0.5), GRID.top - GRID.rowH * (row + 0.5)];
}

/** Paper sheet with a soft curl at the bottom (like the list note), UVs ~1 tile / 0.2 m. */
function sheet(): BufferGeometry {
  const g = new PlaneGeometry(W, H, 6, 12);
  const pos = g.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const xn = pos.getX(i) / W + 0.5;
    const yb = 0.5 - pos.getY(i) / H;
    const curl = Math.max(0, (yb - 0.88) / 0.12);
    pos.setZ(i, 0.003 * Math.sin(Math.PI * xn) + 0.026 * curl * curl * (0.4 + 0.6 * (1 - xn)));
  }
  g.computeVertexNormals();
  return prepPiece(g, { perM: 5, jitter: 0 });
}

function buildStatic(): Part[] {
  const set = new PartSet();
  set.add("paper", sheet());
  // backing card peeking out under the sheet (calendar pad look)
  set.add("paper", block([W - 0.004, H * 0.5, 0.002], [0, H / 4 + 0.004, -0.0012], { r: 0.001, perM: 5 }), { overrides: { color: "#E6D9C3" } });
  // accent header band
  const z = 0.0045;
  set.add("accent", block([W - 0.012, 0.046, 0.0012], [0, H / 2 - 0.036, z - 0.0005], { r: 0.001 }), { cast: false });
  const title = text3d("MEAL PREP", { size: 0.026, align: "center", depth: 0.0008, maxW: W - 0.03 });
  if (title) set.add("paper", prepPiece(title, { pos: [0, H / 2 - 0.046, z + 0.0002], keepUV: true, jitter: 0 }), { overrides: { color: "#FFFFFF" }, cast: false });
  // weekday initials
  const wd = ["S", "M", "T", "W", "T", "F", "S"];
  wd.forEach((ch, col) => {
    const [cx] = cellCenter(col, 0);
    const g = text3d(ch, { size: 0.0115, align: "center", depth: 0.0006 });
    if (g) set.add("ink", prepPiece(g, { pos: [cx, GRID.top + 0.006, z], keepUV: true, jitter: 0 }), { overrides: { color: "#8A6A4F" }, cast: false });
  });
  // grid rules
  for (let r = 0; r <= 5; r++) {
    set.add("ink", block([GRID.right - GRID.left, 0.0011, 0.0005], [0, GRID.top - r * GRID.rowH, z], { r: 0 }), { overrides: { color: "#CDBFA8" }, cast: false });
  }
  // binder clip + nail
  const clipY = H / 2 + 0.004;
  set.add("metal", block([0.05, 0.022, 0.012], [0, clipY, 0.006], { r: 0.003 }), { overrides: { color: "#2B2A2E" } });
  for (const s of [-1, 1]) {
    set.add("metal", prepPiece(new TorusGeometry(0.013, 0.0016, 4, 12, Math.PI), { pos: [s * 0.012, clipY + 0.011, 0.012], rot: [0, 0, 0] }));
  }
  set.add("metal", prepPiece(new CylinderGeometry(0.006, 0.006, 0.004, 10), { pos: [0, clipY + 0.033, 0.006], rot: [Math.PI / 2, 0, 0] }), { overrides: { color: "#6E6A64" } });
  return set.build();
}

/** Month label, day numbers, this week's doodles and today's circle. */
export function buildCalendarContent(monthLabel: string, today: Date): Part[] {
  const set = new PartSet();
  const z = 0.0045;
  const grid = monthGrid(today);
  const label = (monthLabel || defaultMonthLabel(today)).toUpperCase();
  const ml = text3d(label, { size: 0.02, align: "center", depth: 0.0008, maxW: W - 0.04, wobble: 0.02, seed: grid.monthIndex + 1 });
  if (ml) set.add("ink", prepPiece(ml, { pos: [0, H / 2 - 0.087, z], keepUV: true, jitter: 0 }), { cast: false });
  for (const c of grid.cells) {
    const [cx, cy] = cellCenter(c.col, c.row);
    const g = text3d(String(c.day), { size: 0.0105, depth: 0.0005 });
    if (g) set.add("ink", prepPiece(g, { pos: [cx - CELL_W / 2 + 0.003, cy + GRID.rowH / 2 - 0.0135, z], keepUV: true, jitter: 0 }), { cast: false });
    if (c.row !== grid.weekRow || c.day === grid.today.day) continue;
    if (c.day < grid.today.day) {
      // done: a green check mark
      set.add("accent", stroke([cx - 0.007, cy - 0.004], [cx - 0.002, cy - 0.01], 0.0026, z + 0.0006), { cast: false });
      set.add("accent", stroke([cx - 0.002, cy - 0.01], [cx + 0.009, cy + 0.003], 0.0026, z + 0.0006), { cast: false });
    } else if ((c.day + grid.today.day) % 2 === 0) {
      // planned: a little bowl with steam
      const bowl = new CircleGeometry(0.0075, 12, Math.PI, Math.PI);
      set.add("ink", prepPiece(bowl, { pos: [cx + 0.002, cy - 0.004, z + 0.0005], jitter: 0 }), { overrides: { color: "#C96B43" }, cast: false });
      set.add("ink", stroke([cx - 0.002, cy - 0.001], [cx - 0.001, cy + 0.008], 0.0014, z + 0.0006, 0.0012), { overrides: { color: "#9E9488" }, cast: false });
      set.add("ink", stroke([cx + 0.004, cy - 0.001], [cx + 0.005, cy + 0.008], 0.0014, z + 0.0006, 0.0012), { overrides: { color: "#9E9488" }, cast: false });
    } else {
      // planned: a carrot
      const carrot = new CircleGeometry(0.008, 3);
      set.add("ink", prepPiece(carrot, { pos: [cx + 0.002, cy - 0.002, z + 0.0005], rot: [0, 0, -0.4], scale: [0.45, 1.25, 1], jitter: 0 }), { overrides: { color: "#E0892B" }, cast: false });
      set.add("accent", stroke([cx + 0.004, cy + 0.007], [cx + 0.008, cy + 0.011], 0.0018, z + 0.0006), { cast: false });
    }
  }
  // today: hand-drawn circle (a slightly open, tilted ring) in red pen
  const [tcx, tcy] = cellCenter(grid.today.col, grid.today.row);
  // centred on the printed number (top-left of the cell)
  const tx = tcx - CELL_W / 2 + 0.003 + (grid.today.day > 9 ? 0.0065 : 0.0035);
  const ty = tcy + GRID.rowH / 2 - 0.0135 + 0.0045;
  const ring = new TorusGeometry(0.0105, 0.0013, 4, 28, Math.PI * 1.9);
  set.add("pin", prepPiece(ring, { pos: [tx, ty, z + 0.0008], rot: [0, 0, 0.9], scale: [1.18, 0.95, 0.4], jitter: 0 }), { cast: false });
  return set.build();
}

let shared: Part[] | null = null;
export function getCalendarShared(): Part[] {
  shared ??= buildStatic();
  return shared;
}

export const CALENDAR_SHEET = { w: W, h: H };
