// DEV ONLY: the whole room (shell + closed pantry exterior + every station prop) with sample data, framed on the
// overview or on one station. Mount inside a <Canvas> (e.g. the foundation's PantryCanvas). Not used by the app.
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import type { PerspectiveCamera } from "three";

import { PantryExterior } from "../exterior/PantryExterior";
import { Lights } from "../Lights";
import { HouseholdStation } from "./HouseholdStation";
import { LightSwitch } from "./LightSwitch";
import { MealPrepCalendar } from "./MealPrepCalendar";
import { MeStation } from "./MeStation";
import { RecipeBooksStation } from "./RecipeBooksStation";
import { RoomShell } from "./RoomShell";
import { ScannerProp } from "./ScannerProp";
import { getStation, ROOM_OVERVIEW, stationCamera, type RoomStationId } from "./stations";

export const PREVIEW_DATA = {
  picks: ["Oat milk", "Avocados", "Dark chocolate"],
  displayName: "Will",
  avatarInitial: "W",
  members: [
    { name: "Will", initial: "W" },
    { name: "Carson", initial: "C" },
    { name: "Maya", initial: "M" },
    { name: "Jordan", initial: "J" },
  ],
  inviteCount: 2,
  alertCount: 3,
  listPreview: ["ham", "eggs", "rice"],
};

export type RoomPreviewProps = {
  /** "overview" (default) or a station id to frame */
  view?: "overview" | RoomStationId;
  hint?: boolean;
  /** include the foundation's Lights (default true) */
  lights?: boolean;
  /** fixed date for the calendar (screenshots); default today */
  today?: Date;
  /** pantry doors 0 closed .. 1 open (check the calendar clears the door swing) */
  openProgress?: number;
  onPress?: (what: string) => void;
};

function PreviewCamera({ view }: { view: RoomPreviewProps["view"] }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const last = useRef("");
  useFrame(() => {
    const aspect = size.width / Math.max(1, size.height);
    const key = `${view}|${aspect}`;
    if (key === last.current) return;
    last.current = key;
    const st = !view || view === "overview" ? { id: "pantry" as const, label: "", ...ROOM_OVERVIEW } : getStation(view);
    const pose = stationCamera(st, aspect);
    // the overview looks slightly down at the room, like the closed view
    const lift = !view || view === "overview" || view === "pantry" ? 0.45 : 0;
    camera.position.set(pose.position[0], pose.position[1] + lift, pose.position[2]);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    camera.updateProjectionMatrix();
  });
  return null;
}

export function RoomPreview({ view = "overview", hint = true, lights = true, today, openProgress = 0, onPress }: RoomPreviewProps) {
  const press = (what: string) => () => onPress?.(what);
  const d = PREVIEW_DATA;
  const date = today ?? new Date();
  return (
    <>
      <PreviewCamera view={view} />
      {lights ? <Lights /> : null}
      <RoomShell />
      <PantryExterior phase={openProgress > 0 ? "opening" : "closed"} openProgress={openProgress} listPreview={d.listPreview} onPress={press("pantry")} onListPress={press("list")} />
      <MeStation onPress={press("me")} hint={hint} picks={d.picks} displayName={d.displayName} avatarInitial={d.avatarInitial} />
      <HouseholdStation onPress={press("household")} hint={hint} members={d.members} inviteCount={d.inviteCount} alertCount={d.alertCount} />
      <LightSwitch onPress={press("settings")} hint={hint} />
      <ScannerProp onPress={press("scan")} hint={hint} />
      <RecipeBooksStation onPress={press("recipes")} hint={hint} />
      <MealPrepCalendar onPress={press("mealprep")} hint={hint} today={date} monthLabel={date.toLocaleString("en-US", { month: "long" })} />
    </>
  );
}
