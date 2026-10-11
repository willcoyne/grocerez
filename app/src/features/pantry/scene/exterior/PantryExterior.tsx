// The closed/opening pantry (closed-pantry.jpg, open-pantry.jpg): cabinet with louvred doors, wooden "Grocer"
// letters, hanging EZ sign, pinned shopping list, stool + plant, floor and wall. Rendered inside the foundation's
// <Canvas>; lights and the camera live there too.
/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, raycast...) */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Mesh } from "three";

import type { PantryPhase } from "../../types";
import { createAnimState, updateExterior } from "./animation";
import { createExterior, getSharedGeometry, HIT_BOX, NOTE_HIT } from "./builders";
import { listLines } from "./list";
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
};

const noRaycast = () => {};

function setCursor(cursor: string) {
  const doc = (globalThis as { document?: { body?: { style: { cursor: string } } } }).document;
  if (doc?.body) doc.body.style.cursor = cursor;
}

export function PantryExterior({ phase, openProgress, listPreview, onPress, onListPress, listProgress = 0 }: PantryExteriorProps) {
  const exterior = useMemo(() => createExterior(), []);
  const anim = useRef(createAnimState());
  const input = useRef({ phase, openProgress, listProgress });
  const pressRef = useRef(onPress);
  const listPressRef = useRef(onListPress);

  useEffect(() => {
    input.current = { phase, openProgress, listProgress };
    pressRef.current = onPress;
    listPressRef.current = onListPress;
  }, [phase, openProgress, listProgress, onPress, onListPress]);

  useEffect(() => () => exterior.dispose(), [exterior]);

  const linesKey = listLines(listPreview).join("\n");
  useEffect(() => {
    exterior.setListLines(linesKey.split("\n"));
  }, [exterior, linesKey]);

  useFrame((state, delta) => {
    updateExterior(exterior, anim.current, input.current, state.clock.elapsedTime, Math.min(delta, 0.1));
  });

  const tappable = phase === "closed";
  useEffect(() => {
    if (!tappable) {
      anim.current.hover = false;
      anim.current.noteHover = false;
      setCursor("auto");
    }
  }, [tappable, anim]);
  const listTappable = tappable && !!onListPress;

  const { hit: hitGeo, noteHit: noteHitGeo } = getSharedGeometry();
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
    </group>
  );
}
