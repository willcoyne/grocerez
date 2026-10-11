/**
 * Room navigation (SPEC.md round 3): the bottom nav no longer switches screens; it asks the one persistent 3D room
 * (PantryScreen) to move the camera to a station. This tiny external store connects the two without a React context:
 * - the nav bar (and deep links) call `requestStation(id)`; PantryScreen reacts to each new request;
 * - PantryScreen publishes where the camera is (or is heading) with `setCurrentStation(id)`, so the nav bar can
 *   highlight the matching tab.
 * Pure TS + useSyncExternalStore; no three.js.
 */
import { useSyncExternalStore } from "react";

import type { RoomStationId } from "./scene/room/stations";

/** The five nav bar tabs, in order. List, Me and Week are the papers pinned on the pantry. */
export const NAV_TABS = ["pantry", "list", "me", "week", "household"] as const;
export type NavTab = (typeof NAV_TABS)[number];

export function isRoomStationId(v: unknown): v is RoomStationId {
  return v === "pantry" || v === "list" || v === "me" || v === "week" || v === "household" || v === "scan";
}

/** Which tab is lit for a station: the scanner on the stool belongs to the Pantry. */
export function navTabFor(station: RoomStationId): NavTab {
  return station === "scan" ? "pantry" : station;
}

export type StationRequest = { id: RoomStationId; seq: number };

let current: RoomStationId = "pantry";
let request: StationRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Ask the room to go to a station (every call is a new request, even for the same station). */
export function requestStation(id: RoomStationId): void {
  seq += 1;
  request = { id, seq };
  emit();
}

/** PantryScreen: where the camera is or is heading. */
export function setCurrentStation(id: RoomStationId): void {
  if (id === current) return;
  current = id;
  emit();
}

export function useCurrentStation(): RoomStationId {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function useStationRequest(): StationRequest | null {
  return useSyncExternalStore(subscribe, () => request, () => request);
}

/** Tests: back to the initial state. */
export function resetRoomNav(): void {
  current = "pantry";
  request = null;
  emit();
}
