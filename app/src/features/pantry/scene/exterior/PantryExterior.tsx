// The closed/opening pantry (closed-pantry.jpg, open-pantry.jpg): cabinet with louvred doors, wooden "Grocer"
// letters, hanging EZ sign, pinned shopping list, stool + plant, floor and wall. Rendered inside the foundation's
// <Canvas>; lights and the camera live there too.
/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, raycast...) */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Mesh } from "three";

import type { NoteKind, PantryPhase } from "../../types";
import { createAnimState, updateExterior } from "./animation";
import { createExterior, getSharedGeometry, HIT_BOX, ME_HIT, NOTE_HIT, WEEK_HIT } from "./builders";
import { listLines, meNoteLines, weekNoteLines } from "./list";
import { getMaterials } from "./materials";

export { PANTRY_DIMENSIONS } from "./dimensions";

export type PantryExteriorProps = {
  phase: PantryPhase;
  /** 0 = doors closed .. 1 = fully open (driven by the foundation) */
  openProgress: number;
  /** first shopping-list item names; up to 3 are shown, fallback ham/eggs/rice */
  listPreview: string[];
  onPress: () => void;
  /** tap on the pinned shopping list (its own hit target, `closed` only); doors stay shut */
  onListPress?: () => void;
  /** 0 = note pinned .. 1 = lifted off toward the camera (the `list` phase clock, see motion.ts) */
  listProgress?: number;
  /** which paper `listProgress` lifts (List, Me or Week) */
  liftedNote?: NoteKind;
  /** name / allergies / ZIP lines for the Me note pinned below the list; fallback text when empty */
  mePreview?: string[];
  /** tap on the pinned Me note (its own hit target, `closed` only) */
  onMePress?: () => void;
  /** "Mon  Lemon chicken" lines for the Week note pinned below the Me note (spec §13); fallback text when empty */
  weekPreview?: string[];
  /** tap on the pinned Week note (its own hit target, `closed` only) */
  onWeekPress?: () => void;
};

const noRaycast = () => {};

function setCursor(cursor: string) {
  const doc = (globalThis as { document?: { body?: { style: { cursor: string } } } }).document;
  if (doc?.body) doc.body.style.cursor = cursor;
}

export function PantryExterior({
  phase,
  openProgress,
  listPreview,
  onPress,
  onListPress,
  listProgress = 0,
  liftedNote = "list",
  mePreview,
  onMePress,
  weekPreview,
  onWeekPress,
}: PantryExteriorProps) {
  const exterior = useMemo(() => createExterior(), []);
  const anim = useRef(createAnimState());
  const input = useRef({ phase, openProgress, listProgress, liftedNote });
  const pressRef = useRef(onPress);
  const listPressRef = useRef(onListPress);
  const mePressRef = useRef(onMePress);
  const weekPressRef = useRef(onWeekPress);

  useEffect(() => {
    input.current = { phase, openProgress, listProgress, liftedNote };
    pressRef.current = onPress;
    listPressRef.current = onListPress;
    mePressRef.current = onMePress;
    weekPressRef.current = onWeekPress;
  }, [phase, openProgress, listProgress, liftedNote, onPress, onListPress, onMePress, onWeekPress]);

  useEffect(() => () => exterior.dispose(), [exterior]);

  const linesKey = listLines(listPreview).join("\n");
  useEffect(() => {
    exterior.setListLines(linesKey.split("\n"));
  }, [exterior, linesKey]);

  const meKey = meNoteLines(mePreview).join("\n");
  useEffect(() => {
    exterior.setMeLines(meKey.split("\n"));
  }, [exterior, meKey]);

  const weekKey = weekNoteLines(weekPreview).join("\n");
  useEffect(() => {
    exterior.setWeekLines(weekKey.split("\n"));
  }, [exterior, weekKey]);

  useFrame((state, delta) => {
    updateExterior(exterior, anim.current, input.current, state.clock.elapsedTime, Math.min(delta, 0.1));
  });

  const tappable = phase === "closed";
  useEffect(() => {
    if (!tappable) {
      anim.current.hover = false;
      anim.current.noteHover = false;
      anim.current.meHover = false;
      anim.current.weekHover = false;
      setCursor("auto");
    }
  }, [tappable, anim]);
  const listTappable = tappable && !!onListPress;
  const meTappable = tappable && !!onMePress;
  const weekTappable = tappable && !!onWeekPress;

  const { hit: hitGeo, noteHit: noteHitGeo, meHit: meHitGeo, weekHit: weekHitGeo } = getSharedGeometry();
  const hitMat = getMaterials().hit;

  return (
    <group>
      <primitive object={exterior.root} />
      <mesh
        geometry={hitGeo}
        material={hitMat}
        position={HIT_BOX.position}
        raycast={tappable ? Mesh.prototype.raycast : noRaycast}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          pressRef.current();
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          anim.current.hover = true;
          setCursor("pointer");
        }}
        onPointerOut={() => {
          anim.current.hover = false;
          setCursor("auto");
        }}
      />
      {/* Pinned list: its front face sits in front of the pantry's hit box, so it always wins the raycast. */}
      <mesh
        geometry={noteHitGeo}
        material={hitMat}
        position={NOTE_HIT.position}
        raycast={listTappable ? Mesh.prototype.raycast : noRaycast}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          listPressRef.current?.();
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          anim.current.noteHover = true;
          setCursor("pointer");
        }}
        onPointerOut={() => {
          anim.current.noteHover = false;
        }}
      />
      {/* Pinned Me note, directly below the list; same depth trick so it beats the pantry hit box. */}
      <mesh
        geometry={meHitGeo}
        material={hitMat}
        position={ME_HIT.position}
        raycast={meTappable ? Mesh.prototype.raycast : noRaycast}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          mePressRef.current?.();
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          anim.current.meHover = true;
          setCursor("pointer");
        }}
        onPointerOut={() => {
          anim.current.meHover = false;
        }}
      />
      {/* Pinned Week note, below the Me note (spec §13). */}
      <mesh
        geometry={weekHitGeo}
        material={hitMat}
        position={WEEK_HIT.position}
        raycast={weekTappable ? Mesh.prototype.raycast : noRaycast}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          weekPressRef.current?.();
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          anim.current.weekHover = true;
          setCursor("pointer");
        }}
        onPointerOut={() => {
          anim.current.weekHover = false;
        }}
      />
    </group>
  );
}
