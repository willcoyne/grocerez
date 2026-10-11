/* eslint-disable react/no-unknown-property -- React Three Fiber props (position, geometry, material...) */
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Allergen } from "@contracts/dietary";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PantryItem } from "../../types";
import { BackLabel } from "./BackLabel";
import { backPanelFor } from "./backPanel";
import { flipEase, flipPose, stepFlip } from "./flipMotion";
import { foodKindFor, foodVariantFor } from "./foodKind";
import { getFoodShape, HIT_BOX, SLOTS } from "./geometries";
import {
  applyDim,
  applyGlow,
  ALLERGEN_RED,
  createHaloMaterial,
  createSlotMaterials,
  disposeSlotMaterials,
  glowPulse,
  HIGHLIGHT_GOLD,
  type SlotMaterials,
} from "./materials";
import { NameTag } from "./NameTag";
import { foodColorsFor } from "./palette";

export { foodKindFor } from "./foodKind";
export { FLIP_DURATION_S, FLIP_POP, flipEase, flipPose, stepFlip } from "./flipMotion";
export { backPanelFor, flippedLabelFrame, type BackPanel, type LabelFrame } from "./backPanel";

/** Pointer travel (CSS px / device-independent px) above which a press counts as a drag, not a tap. */
export const TAP_SLOP_PX = 8;

/** True when an R3F click/pointer-up should count as a tap (pointer barely moved since pointer-down). */
export function isTap(e: Pick<ThreeEvent<MouseEvent>, "delta">): boolean {
  return !(e.delta > TAP_SLOP_PX);
}

/** Seconds of bounce + bright ring after a search hit, before settling to a steady ring. */
export const HIGHLIGHT_INTRO_S = 2;

export type FoodItemProps = {
  item: PantryItem;
  position: [number, number, number];
  glow: boolean;
  dimmed: boolean;
  highlighted: boolean;
  onPress: () => void;
  /** show the back label (rotate 180° about Y) */
  flipped?: boolean;
  /** viewer's allergens, shown in red on the back label */
  myAllergens?: Allergen[];
  /** OS "reduce motion": the flip snaps instead of turning */
  reducedMotion?: boolean;
  /** draw the small name tag in front of the item (default true; the store has its own shelf-edge tags) */
  showTag?: boolean;
};

const NO_ALLERGENS: Allergen[] = [];

const HALO_GEO = new THREE.PlaneGeometry(1, 1);
const RING_GEO = new THREE.RingGeometry(0.175, 0.205, 40).rotateX(-Math.PI / 2);
const _q = new THREE.Quaternion();

/**
 * One pantry item: procedural mesh by kind, a name tag, allergen glow (pulsing red emissive + additive halo),
 * dim (filtered out) and search highlight (bounce + gold ring). Sits on local y=0, ≤0.32w × ≤0.42h.
 */
export function FoodItem({
  item,
  position,
  glow,
  dimmed,
  highlighted,
  onPress,
  flipped = false,
  myAllergens = NO_ALLERGENS,
  reducedMotion = false,
  showTag = true,
}: FoodItemProps) {
  const { name, brand, category, location } = item;
  const kind = useMemo(() => foodKindFor({ name, brand, category, location }), [name, brand, category, location]);
  const variant = useMemo(() => foodVariantFor({ name }, kind), [name, kind]);
  const shape = getFoodShape(kind, variant);
  const colors = useMemo(() => foodColorsFor({ name, brand }, kind, variant), [name, brand, kind, variant]);

  const mats = useMemo(() => createSlotMaterials(shape, colors), [shape, colors]);
  /** where the label is printed on this shape's back face */
  const panel = backPanelFor(kind, variant);
  // the back label is built lazily on the first flip, then kept (cheap to show again)
  const [backBuilt, setBackBuilt] = useState(flipped);
  if (flipped && !backBuilt) setBackBuilt(true);
  useEffect(() => () => disposeSlotMaterials(mats), [mats]);
  useEffect(() => applyDim(mats, dimmed), [mats, dimmed]);
  useEffect(() => {
    if (!glow) applyGlow(mats, null);
  }, [mats, glow]);

  const haloMat = useMemo(() => (glow ? createHaloMaterial(ALLERGEN_RED) : null), [glow]);
  const ringMat = useMemo(
    () => (highlighted ? new THREE.MeshBasicMaterial({ color: HIGHLIGHT_GOLD, transparent: true, depthWrite: false, toneMapped: false }) : null),
    [highlighted],
  );
  const hiHaloMat = useMemo(() => (highlighted ? createHaloMaterial(HIGHLIGHT_GOLD) : null), [highlighted]);
  useEffect(() => () => haloMat?.dispose(), [haloMat]);
  useEffect(() => () => ringMat?.dispose(), [ringMat]);
  useEffect(() => () => hiHaloMat?.dispose(), [hiHaloMat]);

  const body = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const hiHalo = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const hiStart = useRef<number | null>(null);
  const pop = useRef<THREE.Group>(null);
  const flip = useRef<THREE.Group>(null);
  const back = useRef<THREE.Group>(null);
  const flipP = useRef(flipped ? 1 : 0);
  /** progress the three groups currently show (they start at the front pose) */
  const appliedP = useRef(0);
  // three objects are mutated per frame through refs (not render-scope values)
  const matsRef = useRef<SlotMaterials | null>(null);
  useEffect(() => {
    matsRef.current = mats;
  }, [mats]);
  useEffect(() => {
    if (!highlighted) hiStart.current = null;
  }, [highlighted]);

  useFrame(({ clock, camera }, delta) => {
    const t = clock.elapsedTime;
    const dimK = dimmed ? 0.35 : 1;
    if (glow) {
      const p = glowPulse(t);
      if (matsRef.current) applyGlow(matsRef.current, p);
      const hm = halo.current?.material as THREE.ShaderMaterial | undefined;
      if (hm?.uniforms) hm.uniforms.uIntensity.value = (0.3 + 0.45 * p) * dimK;
    }
    let bounce = 0;
    if (highlighted) {
      if (hiStart.current === null) hiStart.current = t;
      const ht = t - hiStart.current;
      const intro = ht < HIGHLIGHT_INTRO_S;
      if (intro) bounce = 0.05 * Math.abs(Math.sin(ht * Math.PI * 2.5)) * (1 - ht / HIGHLIGHT_INTRO_S);
      if (ring.current) {
        (ring.current.material as THREE.MeshBasicMaterial).opacity = (intro ? 0.75 + 0.25 * Math.sin(ht * 12) : 0.85) * dimK;
        ring.current.scale.setScalar(intro ? 1 + 0.12 * Math.abs(Math.sin(ht * Math.PI * 2.5)) : 1);
      }
      const hh = hiHalo.current?.material as THREE.ShaderMaterial | undefined;
      if (hh?.uniforms) hh.uniforms.uIntensity.value = (intro ? 0.5 + 0.2 * Math.sin(ht * 8) : 0.28) * dimK;
    }
    if (body.current) body.current.position.y = bounce;
    const next = reducedMotion ? (flipped ? 1 : 0) : stepFlip(flipP.current, flipped ? 1 : 0, delta);
    if (next !== appliedP.current) {
      flipP.current = next;
      appliedP.current = next;
      const pose = flipPose(flipEase(flipP.current));
      if (flip.current) flip.current.rotation.y = pose.rotY;
      if (pop.current) pop.current.position.set(0, pose.y, pose.z);
      if (back.current) back.current.visible = flipP.current > 0.001;
    }
    // billboard the halos toward the camera
    for (const h of [halo.current, hiHalo.current]) {
      if (!h?.parent) continue;
      h.parent.getWorldQuaternion(_q);
      h.quaternion.copy(_q.invert().multiply(camera.quaternion));
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return;
    e.stopPropagation();
    onPress();
  };

  // halo hugs the item: bottom edge near the shelf so it doesn't bleed under the board
  const haloW = 0.62;
  const haloH = shape.height + 0.34;
  const haloY = haloH / 2 - 0.06;

  return (
    <group position={position}>
      {haloMat ? <mesh ref={halo} geometry={HALO_GEO} material={haloMat} position={[0, haloY, -0.13]} scale={[haloW, haloH, 1]} renderOrder={-1} /> : null}
      {hiHaloMat ? <mesh ref={hiHalo} geometry={HALO_GEO} material={hiHaloMat} position={[0, haloY, -0.14]} scale={[haloW * 1.1, haloH * 1.1, 1]} renderOrder={-1} /> : null}
      {ringMat ? <mesh ref={ring} geometry={RING_GEO} material={ringMat} position={[0, 0.004, 0.0]} /> : null}
      <group ref={pop}>
        <group ref={flip}>
          <group ref={body}>
            {SLOTS.map((slot) => {
              const g = shape.parts[slot];
              const m = mats[slot];
              if (!g || !m) return null;
              return <mesh key={slot} geometry={g} material={m} castShadow={slot === "primary" && !dimmed} receiveShadow={false} />;
            })}
          </group>
          {showTag ? <NameTag name={name} low={item.status === "running_low"} warn={glow} dimmed={dimmed} /> : null}
          {backBuilt ? (
            <group ref={back}>
              <BackLabel item={item} kind={kind} panel={panel} myAllergens={myAllergens} />
            </group>
          ) : null}
        </group>
        <mesh
          geometry={HIT_BOX}
          visible={false}
          onClick={onClick}
          onPointerOver={() => setCursor("pointer")}
          onPointerOut={() => setCursor("auto")}
        />
      </group>
    </group>
  );
}

function setCursor(c: string) {
  const doc = (globalThis as { document?: { body?: { style: { cursor: string } } } }).document;
  if (doc?.body) doc.body.style.cursor = c;
}
