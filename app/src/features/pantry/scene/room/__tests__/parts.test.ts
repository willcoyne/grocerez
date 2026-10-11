import { Box3, Vector3 } from "three";

import { hintEnvelope, pressBounce } from "../interaction";
import { CORK_BOARD, ME_BOARD, SCANNER, STOOL } from "../layout";
import { fitText, type Part } from "../parts/common";
import { badgeLabel, buildBadge, buildHouseholdContent, getHouseholdFrame, householdCounts } from "../parts/household";
import { avatarColor, AVATAR_COLORS, buildPicksText, buildPolaroid, getMeShared, pickLines } from "../parts/me";
import { getScannerShared, SCANNER_FOOTPRINT } from "../parts/scanner";
import { buildShell } from "../parts/shell";
import { ROOM_MATERIAL_ROLES, roomMaterial } from "../roomMaterials";

function bounds(parts: readonly Part[]): Box3 {
  const b = new Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    b.union(p.geometry.boundingBox!);
  }
  return b;
}

function wellFormed(parts: readonly Part[]) {
  expect(parts.length).toBeGreaterThan(0);
  for (const p of parts) {
    expect(ROOM_MATERIAL_ROLES).toContain(p.role);
    for (const a of ["position", "normal", "uv", "color"]) expect(p.geometry.getAttribute(a)).toBeTruthy();
    const pos = p.geometry.getAttribute("position").array as Float32Array;
    expect(pos.every(Number.isFinite)).toBe(true);
  }
}

describe("room part builders", () => {
  it("build well-formed, role-tagged geometry for every prop", () => {
    const me = getMeShared();
    for (const set of [me.board, me.apron, me.clothespin, getHouseholdFrame(), getScannerShared().body, getScannerShared().beam, buildShell(true), buildShell(false)]) {
      wellFormed(set);
    }
    wellFormed(buildPicksText(["Oat milk", "Avocados", "Dark chocolate"]));
    wellFormed(buildPicksText([]));
    wellFormed(buildPolaroid("W", "Will", "#C8553D"));
    wellFormed(buildHouseholdContent([{ name: "Will", initial: "W" }], 2, 3));
    wellFormed(buildBadge(12));
  });

  it("keeps the chalkboard and cork board content within their frames", () => {
    const board = bounds([...getMeShared().board, ...buildPicksText(["A very long preference name that must be squeezed", "b", "c"])]);
    expect(board.max.x).toBeLessThanOrEqual(ME_BOARD.w / 2 + 1e-6);
    expect(board.min.x).toBeGreaterThanOrEqual(-ME_BOARD.w / 2 - 1e-6);
    const cork = bounds(buildHouseholdContent(Array.from({ length: 8 }, (_, i) => ({ name: `Member number ${i}`, initial: "M" })), 9, 9));
    expect(cork.max.x).toBeLessThanOrEqual(CORK_BOARD.w / 2);
    expect(cork.min.x).toBeGreaterThanOrEqual(-CORK_BOARD.w / 2);
    expect(cork.max.y).toBeLessThanOrEqual(CORK_BOARD.h / 2);
    expect(cork.min.y).toBeGreaterThanOrEqual(-CORK_BOARD.h / 2);
  });

  it("lays the scanner on the seat, beside (not inside) the pot", () => {
    const c = Math.cos(SCANNER.yaw);
    const s = Math.sin(SCANNER.yaw);
    for (const [fx, fz] of SCANNER_FOOTPRINT) {
      const lx = fx * SCANNER.scale;
      const lz = fz * SCANNER.scale;
      // rotation about +y: x' = x cos + z sin, z' = -x sin + z cos
      const x = SCANNER.x + lx * c + lz * s - STOOL.x;
      const z = SCANNER.z - lx * s + lz * c - STOOL.z;
      const r = Math.hypot(x, z);
      expect(r).toBeLessThan(STOOL.seatRadius + 0.012);
      expect(r).toBeGreaterThan(STOOL.potBaseRadius);
    }
    const body = bounds(getScannerShared().body);
    expect(body.min.y).toBeGreaterThanOrEqual(-0.0025); // rests on the seat (the rubber bumper may sink 2 mm)
    expect(body.min.y).toBeLessThan(0.004);
  });
});

describe("pure helpers", () => {
  it("pickLines keeps the first 3 non-empty picks", () => {
    expect(pickLines([" Oat  milk ", "", "Avocados", "Tea", "Kale"])).toEqual(["Oat milk", "Avocados", "Tea"]);
    expect(pickLines(undefined)).toEqual([]);
  });

  it("fitText shrinks, then truncates", () => {
    expect(fitText("ham", 0.04, 1).scale).toBe(1);
    const t = fitText("Supercalifragilistic expialidocious", 0.05, 0.2, 0.6);
    expect(t.text.endsWith("..")).toBe(true);
    expect(t.scale).toBe(0.6);
  });

  it("avatar colours are deterministic and from the palette", () => {
    expect(avatarColor("Will")).toBe(avatarColor(" will "));
    expect(AVATAR_COLORS).toContain(avatarColor("Carson"));
  });

  it("household counts cap what is drawn; the badge shows a number", () => {
    expect(householdCounts(Array(7).fill({ name: "a", initial: "A" }), 5, 12)).toEqual({ polaroids: 5, postcards: 3, pins: 3, badge: true });
    expect(householdCounts([], 0, 0)).toEqual({ polaroids: 0, postcards: 0, pins: 0, badge: false });
    expect(badgeLabel(3)).toBe("3");
    expect(badgeLabel(42)).toBe("9+");
  });

  it("hint envelope is a short, de-synced bump; press bounce settles", () => {
    expect(hintEnvelope(0.55, 0, 4.8, 1.1)).toBeCloseTo(1, 5);
    expect(hintEnvelope(2, 0)).toBe(0);
    expect(hintEnvelope(0.55, 1)).not.toBeCloseTo(hintEnvelope(0.55, 0), 3);
    expect(pressBounce(-1)).toBe(0);
    expect(pressBounce(1)).toBe(0);
  });

  it("caches one material per role + overrides", () => {
    expect(roomMaterial("wood")).toBe(roomMaterial("wood"));
    expect(roomMaterial("paper", { color: "#ff0000" })).not.toBe(roomMaterial("paper"));
    for (const r of ROOM_MATERIAL_ROLES) expect(roomMaterial(r)).toBeTruthy();
  });
});
