import { Box3 } from "three";

import { getSharedGeometry } from "../../exterior/builders";
import { PANTRY_DIMENSIONS as D } from "../../exterior/dimensions";
import { fitDistance, noteDistance, TAN } from "../../motion";
import { HIT, STOOL, VISUAL, type Box } from "../layout";
import { getStation, ROOM_BOUNDS, ROOM_STATIONS, stationCamera, type RoomStationId } from "../stations";

const IDS: RoomStationId[] = ["pantry", "list", "me", "week", "household", "scan"];
const ASPECTS = [9 / 19.5, 9 / 16, 3 / 4, 16 / 9];

describe("ROOM_STATIONS", () => {
  it("has every station exactly once, with a label and positive framing", () => {
    expect(ROOM_STATIONS.map((s) => s.id).sort()).toEqual([...IDS].sort());
    for (const s of ROOM_STATIONS) {
      expect(s.label.trim().length).toBeGreaterThan(0);
      expect(s.fitWidth).toBeGreaterThan(0);
      expect(s.fitHeight).toBeGreaterThan(0);
      expect(s.focus.every(Number.isFinite)).toBe(true);
    }
  });

  it("keeps every focus inside ROOM_BOUNDS, and the room spans x ∈ [-3.4, 3.6]", () => {
    expect(ROOM_BOUNDS.minX).toBe(-3.4);
    expect(ROOM_BOUNDS.maxX).toBe(3.6);
    for (const s of ROOM_STATIONS) {
      const [x, y, z] = s.focus;
      expect(x).toBeGreaterThanOrEqual(ROOM_BOUNDS.minX);
      expect(x).toBeLessThanOrEqual(ROOM_BOUNDS.maxX);
      expect(y).toBeGreaterThanOrEqual(ROOM_BOUNDS.minY);
      expect(y).toBeLessThanOrEqual(ROOM_BOUNDS.maxY);
      expect(z).toBeGreaterThanOrEqual(ROOM_BOUNDS.minZ);
      expect(z).toBeLessThanOrEqual(ROOM_BOUNDS.maxZ);
      // the framed rectangle stays inside the room horizontally (camera never sees past the side walls)
      expect(x - s.fitWidth / 2).toBeGreaterThanOrEqual(ROOM_BOUNDS.minX);
      expect(x + s.fitWidth / 2).toBeLessThanOrEqual(ROOM_BOUNDS.maxX);
    }
  });

  it("puts the stations where the SPEC says", () => {
    const near = (id: RoomStationId, x: number, y: number, tol: number) => {
      const s = getStation(id);
      expect(Math.abs(s.focus[0] - x)).toBeLessThan(tol);
      expect(Math.abs(s.focus[1] - y)).toBeLessThan(tol);
    };
    near("household", 2.45, 2.35, 0.1);
    near("list", D.note.x, D.note.y, 1e-9);
    near("me", D.meNote.x, D.meNote.y, 1e-9);
    near("week", D.weekNote.x, D.weekNote.y, 1e-9);
  });

  it("pitch orbits the camera up around the focus at the same distance", () => {
    const scan = getStation("scan");
    expect(scan.pitch).toBeGreaterThan(0);
    const c = stationCamera(scan, 9 / 19.5);
    const d = Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);
    expect(d).toBeCloseTo(c.distance, 9);
    expect(c.position[1]).toBeGreaterThan(c.target[1]);
  });

  it("frames the pantry like the closed view and the list like the existing note zoom", () => {
    const p = getStation("pantry");
    expect(p.fitWidth).toBeCloseTo(D.bounds.maxX - D.bounds.minX + 0.2, 9);
    expect(p.fitHeight).toBeCloseTo(D.bounds.maxY - D.bounds.minY + 0.5, 9);
    for (const id of ["list", "me", "week"] as const) {
      const paper = getStation(id);
      for (const a of ASPECTS) expect(stationCamera(paper, a).distance).toBeCloseTo(noteDistance(D.note.width, D.note.height, a), 9);
    }
  });

  it("fits each prop's visual extent inside its framing at every aspect", () => {
    const pairs: [RoomStationId, keyof typeof VISUAL][] = [
      ["household", "household"],
      ["scan", "scanner"],
    ];
    for (const [id, key] of pairs) {
      const s = getStation(id);
      const v = VISUAL[key];
      for (const a of ASPECTS) {
        const { distance, target: position } = stationCamera(s, a);
        expect(distance).toBeCloseTo(fitDistance(s.fitWidth / 2, s.fitHeight / 2, a), 9);
        const halfH = distance * TAN;
        const halfW = halfH * a;
        expect(v.min[0]).toBeGreaterThanOrEqual(position[0] - halfW - 1e-9);
        expect(v.max[0]).toBeLessThanOrEqual(position[0] + halfW + 1e-9);
        expect(v.min[1]).toBeGreaterThanOrEqual(position[1] - halfH - 1e-9);
        expect(v.max[1]).toBeLessThanOrEqual(position[1] + halfH + 1e-9);
      }
    }
  });
});

describe("room layout", () => {
  const overlap = (a: Box, b: Box) =>
    [0, 1, 2].every((k) => Math.abs(a.center[k] - b.center[k]) < (a.size[k] + b.size[k]) / 2 - 1e-9);

  it("the mounted props' hit boxes (cork board, scanner) don't overlap each other or the pantry's tap-to-open box", () => {
    const pantry: Box = { center: [0, 2.1, -0.25], size: [2.7, 4.2, 1.5] }; // exterior/builders.ts HIT_BOX
    expect(overlap(HIT.household, HIT.scanner)).toBe(false);
    for (const k of ["household", "scanner"] as const) expect(overlap(HIT[k], pantry)).toBe(false);
  });

  it("mirrors the stool position from exterior/builders.ts (the potted plant sits on the seat centre)", () => {
    const plant = getSharedGeometry().plant;
    plant.computeBoundingBox();
    const bb = plant.boundingBox as Box3;
    expect(Math.abs((bb.min.x + bb.max.x) / 2 - STOOL.x)).toBeLessThan(0.03);
    expect(Math.abs((bb.min.z + bb.max.z) / 2 - STOOL.z)).toBeLessThan(0.06);
    // leaves start just above the soil (seat top + 0.158)
    expect(Math.abs(bb.min.y - (STOOL.seatTop + 0.158))).toBeLessThan(0.03);
  });
});
