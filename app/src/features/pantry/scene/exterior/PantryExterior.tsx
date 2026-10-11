// The closed/opening pantry (closed-pantry.jpg, open-pantry.jpg): cabinet with louvred doors, wooden "Grocer"
// letters, hanging EZ sign, the pinned List / Me / Week papers, stool + plant. Rendered inside the foundation's
// <Canvas>; lights and the camera live there too (the wall + floor are the room shell, scene/room/RoomShell).
/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, raycast...) */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import { type BufferGeometry, type Material, Mesh } from "three";

import { useSceneTheme } from "../../../theme/ThemeProvider";
import type { NoteKind, PantryPhase } from "../../types";
import { createAnimState, type ExteriorAnimState, type ExteriorInput, updateExterior } from "./animation";
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
  /**
   * Live phase clock (motion.ts PhaseClock; `open` is the LINEAR door clock). When given, the doors read it every
   * frame instead of `openProgress`, so they move in step with the camera, without React-render lag or the
   * re-render quantisation of `openProgress` (which made the last degrees of a close stutter).
   */
  clock?: { readonly current: { readonly open: number } };
};

const noRaycast = () => {};

function setCursor(cursor: string) {
  const doc = (globalThis as { document?: { body?: { style: { cursor: string } } } }).document;
  if (doc?.body) doc.body.style.cursor = cursor;
}

type HoverKey = "noteHover" | "meHover" | "weekHover";

/**
 * Tap target for one pinned paper: its front face sits in front of the pantry's hit box, so it always wins the
 * raycast and the doors stay shut.
 */
function PaperHit({
  geometry,
  material,
  position,
  enabled,
  onPress,
  anim,
  hoverKey,
}: {
  geometry: BufferGeometry;
  material: Material;
  position: [number, number, number];
  enabled: boolean;
  onPress: MutableRefObject<(() => void) | undefined>;
  anim: MutableRefObject<ExteriorAnimState>;
  hoverKey: HoverKey;
}) {
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      raycast={enabled ? Mesh.prototype.raycast : noRaycast}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onPress.current?.();
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        anim.current[hoverKey] = true;
        setCursor("pointer");
      }}
      onPointerOut={() => {
        anim.current[hoverKey] = false;
      }}
    />
  );
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
  clock,
}: PantryExteriorProps) {
  const theme = useSceneTheme();
  const exterior = useMemo(() => createExterior(theme), [theme]);
  const anim = useRef(createAnimState());
  const input = useRef<ExteriorInput>({ phase, openProgress, listProgress, liftedNote });
  const pressRef = useRef(onPress);
  const listPressRef = useRef(onListPress);
  const mePressRef = useRef(onMePress);
  const weekPressRef = useRef(onWeekPress);
  const clockRef = useRef(clock);

  useEffect(() => {
    input.current = { phase, openProgress, listProgress, liftedNote };
    pressRef.current = onPress;
    listPressRef.current = onListPress;
    mePressRef.current = onMePress;
    weekPressRef.current = onWeekPress;
    clockRef.current = clock;
  }, [phase, openProgress, listProgress, liftedNote, onPress, onListPress, onMePress, onWeekPress, clock]);

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
    input.current.openClock = clockRef.current?.current.open;
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

  const geos = getSharedGeometry(theme);
  const hitMat = getMaterials(theme).hit;

  return (
    <group>
      <primitive object={exterior.root} />
      <mesh
        geometry={geos.hit}
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
      <PaperHit
        geometry={geos.noteHit}
        material={hitMat}
        position={[...NOTE_HIT.position]}
        enabled={tappable && !!onListPress}
        onPress={listPressRef}
        anim={anim}
        hoverKey="noteHover"
      />
      <PaperHit
        geometry={geos.meHit}
        material={hitMat}
        position={[...ME_HIT.position]}
        enabled={tappable && !!onMePress}
        onPress={mePressRef}
        anim={anim}
        hoverKey="meHover"
      />
      <PaperHit
        geometry={geos.weekHit}
        material={hitMat}
        position={[...WEEK_HIT.position]}
        enabled={tappable && !!onWeekPress}
        onPress={weekPressRef}
        anim={anim}
        hoverKey="weekHover"
      />
    </group>
  );
}
