/**
 * The room around the pantry (SPEC.md round 3): RoomShell (wide floor, back wall, side walls) and every station prop,
 * fed with display data from useRoomData. A tap on a prop asks PantryScreen to fly to that station (`onStation`).
 * PantryScreen mounts this inside a masked group (hidden + off the interactive layer whenever the exterior is hidden,
 * i.e. inside the shelves) and passes `disabled` outside the closed pantry view so props stop reacting to hover/taps.
 */
import { useMemo } from "react";

import {
  HouseholdStation,
  LightSwitch,
  MealPrepCalendar,
  MeStation,
  RecipeBooksStation,
  RoomShell,
  ScannerProp,
  type RoomStationId,
} from "./scene/room";
import type { RoomData } from "./useRoomData";

export type RoomLayerProps = {
  data: RoomData;
  onStation: (id: RoomStationId) => void;
  /** no taps / hover / "tap me" hints (shelves, zooms, a sheet open) */
  disabled: boolean;
};

export function RoomLayer({ data, onStation, disabled }: RoomLayerProps) {
  const press = useMemo(
    () => ({
      me: () => onStation("me"),
      household: () => onStation("household"),
      settings: () => onStation("settings"),
      scan: () => onStation("scan"),
      recipes: () => onStation("recipes"),
      mealprep: () => onStation("mealprep"),
    }),
    [onStation],
  );
  const hint = !disabled;
  return (
    <group name="RoomLayer">
      <RoomShell />
      <MeStation
        onPress={press.me}
        hint={hint}
        disabled={disabled}
        picks={data.picks}
        displayName={data.displayName}
        avatarInitial={data.avatarInitial}
      />
      <HouseholdStation
        onPress={press.household}
        hint={hint}
        disabled={disabled}
        members={data.members}
        inviteCount={data.inviteCount}
        alertCount={data.alertCount}
      />
      <LightSwitch onPress={press.settings} hint={hint} disabled={disabled} />
      <ScannerProp onPress={press.scan} hint={hint} disabled={disabled} />
      <RecipeBooksStation onPress={press.recipes} hint={hint} disabled={disabled} />
      <MealPrepCalendar
        onPress={press.mealprep}
        hint={hint}
        disabled={disabled}
        monthLabel={data.monthLabel}
        today={data.today}
      />
    </group>
  );
}
