// Room shell for the one-room app (SPEC "Round 3"): floor, back wall and baseboard across ROOM_BOUNDS
// (x∈[-3.4, 3.6]) plus optional side walls at the bounds so wide shots read as a room.
//
// DROP-IN REPLACEMENT for the exterior's own wall / floor / baseboard (exterior/builders.ts: the `wall` + `floor`
// meshes added in createExterior() and the baseboard piece merged into buildStaticPaint()). Its surfaces sit
// 2–4 mm proud of those, so mounting <RoomShell/> next to the current <PantryExterior/> already works (it covers
// them, no z-fighting). Integration step: stop drawing the exterior's wall, floor and baseboard (saves two
// full-screen draws); nothing else changes.
import { useEffect, useMemo } from "react";

import { Parts } from "./interaction";
import { buildShell } from "./parts/shell";
import { disposeParts } from "./parts/common";

export type RoomShellProps = {
  /** side walls at ROOM_BOUNDS.minX / maxX (default true); false = a very wide open wall like the exterior's */
  sideWalls?: boolean;
};

export function RoomShell({ sideWalls = true }: RoomShellProps) {
  const parts = useMemo(() => buildShell(sideWalls), [sideWalls]);
  useEffect(() => () => disposeParts(parts), [parts]);
  return (
    <group name="RoomShell">
      <Parts parts={parts} />
    </group>
  );
}
