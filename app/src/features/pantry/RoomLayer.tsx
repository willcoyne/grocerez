/**
 * The room around the pantry (SPEC.md round 3): RoomShell (wide floor, back wall, side walls), the household cork
 * board on the wall right of the pantry and the handheld scanner on the stool, fed with display data from useRoomData.
 * A tap on a prop asks PantryScreen to fly to that station (`onStation`). The List, Me and Week papers are part of the
 * pantry exterior, not the room. PantryScreen mounts this inside a masked group (hidden + off the interactive layer
 * whenever the exterior is hidden, i.e. inside the shelves) and passes `disabled` outside the closed pantry view.
 */
import { useMemo } from "react";

import { HouseholdStation, RoomShell, ScannerProp, type RoomStationId } from "./scene/room";
import type { RoomData } from "./useRoomData";

export type RoomLayerProps = {
  data: RoomData;
  onStation: (id: RoomStationId) => void;
  /** no taps / hover / "tap me" hints (shelves, zooms, a sheet open) */
  disabled: boolean;
};

export function RoomLayer({ data, onStation, disabled }: RoomLayerProps) {
  const press = useMemo(() => ({ household: () => onStation("household"), scan: () => onStation("scan") }), [onStation]);
  const hint = !disabled;
  return (
    <group name="RoomLayer">
      <RoomShell />
      <HouseholdStation
        onPress={press.household}
        hint={hint}
        disabled={disabled}
        members={data.members}
        inviteCount={data.inviteCount}
        alertCount={data.alertCount}
      />
      <ScannerProp onPress={press.scan} hint={hint} disabled={disabled} />
    </group>
  );
}
