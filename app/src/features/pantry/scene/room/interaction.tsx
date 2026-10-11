/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, raycast...) */
// Shared behaviour for every room prop: invisible generous hit boxes, tap → onPress (stopPropagation), web hover
// cursor, a smoothed hover/press state for animation, the idle "tap me" hint clock and a little sparkle (Glint).
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, type Group, Mesh } from "three";

import type { Box } from "./layout";
import type { Part } from "./parts/common";
import { useRoomMaterial } from "./roomMaterials";

export function setCursor(cursor: string) {
  const doc = (globalThis as { document?: { body?: { style: { cursor: string } } } }).document;
  if (doc?.body) doc.body.style.cursor = cursor;
}

/**
 * 0..1 "tap me" envelope: a soft bump `length` s long every `period` s. `offset` de-syncs props so they never all
 * wiggle together. Pure.
 */
export function hintEnvelope(t: number, offset = 0, period = 4.8, length = 1.1): number {
  const local = (((t + offset) % period) + period) % period;
  if (local >= length) return 0;
  const s = Math.sin((local / length) * Math.PI);
  return s * s;
}

/** Press "boing": 0 at rest, dips then springs back over ~0.45 s after a tap. Pure. */
export function pressBounce(sincePress: number): number {
  if (sincePress < 0 || sincePress > 0.45) return 0;
  return Math.exp(-7 * sincePress) * Math.sin(sincePress * 22);
}

export type PropMotion = {
  /** pointer over (web) */
  hover: boolean;
  /** smoothed 0..1 hover */
  hoverK: number;
  /** clock time of the last tap (for pressBounce) */
  pressedAt: number;
  /** clock time, updated every frame */
  now: number;
  hint: boolean;
  disabled: boolean;
};

export type RoomPropProps = {
  onPress: () => void;
  /** idle "tap me" hint (gentle bob / glint every few seconds) */
  hint?: boolean;
  /** stop taps / hover (e.g. while the camera is inside the shelves) */
  disabled?: boolean;
};

/** Motion state + pointer handlers for one prop. Animate from `motion.current` inside your own useFrame. */
export function useRoomProp({ onPress, hint = false, disabled = false }: RoomPropProps) {
  const motion = useRef<PropMotion>({ hover: false, hoverK: 0, pressedAt: -10, now: 0, hint, disabled });
  const press = useRef(onPress);
  useEffect(() => {
    press.current = onPress;
    motion.current.hint = hint;
    motion.current.disabled = disabled;
    if (disabled && motion.current.hover) {
      motion.current.hover = false;
      setCursor("auto");
    }
  }, [onPress, hint, disabled]);
  useEffect(
    () => () => {
      if (motion.current.hover) setCursor("auto");
    },
    [],
  );
  useFrame((state, delta) => {
    const m = motion.current;
    m.now = state.clock.elapsedTime;
    m.hoverK += ((m.hover ? 1 : 0) - m.hoverK) * Math.min(1, Math.min(delta, 0.1) * 10);
  });
  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (motion.current.disabled) return;
      motion.current.pressedAt = motion.current.now;
      press.current();
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (motion.current.disabled) return;
      motion.current.hover = true;
      setCursor("pointer");
    },
    onPointerOut: () => {
      if (!motion.current.hover) return;
      motion.current.hover = false;
      setCursor("auto");
    },
  };
  return { motion, handlers };
}

export type PropHandlers = ReturnType<typeof useRoomProp>["handlers"];

let unitBox: BoxGeometry | null = null;
const noRaycast = () => {};

/** Invisible tap targets in WORLD coordinates (mount them outside any animated / offset group). */
export function PropHitBoxes({ boxes, handlers, disabled = false, name }: { boxes: readonly Box[]; handlers: PropHandlers; disabled?: boolean; name: string }) {
  unitBox ??= new BoxGeometry(1, 1, 1);
  const mat = useRoomMaterial()("hit");
  return (
    <>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          name={`${name}-hit-${i}`}
          geometry={unitBox!}
          material={mat}
          position={b.center}
          scale={b.size}
          raycast={disabled ? noRaycast : Mesh.prototype.raycast}
          onClick={handlers.onClick}
          onPointerOver={handlers.onPointerOver}
          onPointerOut={handlers.onPointerOut}
        />
      ))}
    </>
  );
}

/** Renders merged role parts with the (themeable) room materials. */
export function Parts({ parts }: { parts: readonly Part[] }) {
  const mat = useRoomMaterial();
  return (
    <>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={mat(p.role, p.overrides)} castShadow={p.castShadow} receiveShadow={p.receiveShadow} />
      ))}
    </>
  );
}

let starGeo: BufferGeometry | null = null;
/** Four-point sparkle star in the XY plane, radius 1. */
function star(): BufferGeometry {
  if (starGeo) return starGeo;
  const pts: number[] = [];
  const arm = (dx: number, dy: number) => {
    const px = -dy * 0.16;
    const py = dx * 0.16;
    pts.push(0, 0, 0, dx, dy, 0, px, py, 0, 0, 0, 0, -px, -py, 0, dx, dy, 0);
  };
  arm(1, 0);
  arm(-1, 0);
  arm(0, 1);
  arm(0, -1);
  // small diagonal arms
  const d = 0.45;
  arm(d, d);
  arm(-d, d);
  arm(d, -d);
  arm(-d, -d);
  starGeo = new BufferGeometry();
  starGeo.setAttribute("position", new Float32BufferAttribute(pts, 3));
  starGeo.computeBoundingSphere();
  return starGeo;
}

/** A soft sparkle that pops on the hint beat (scale-animated, so the shared material is never mutated). */
export function Glint({ position, size = 0.05, motion, offset = 0 }: { position: [number, number, number]; size?: number; motion: { current: PropMotion }; offset?: number }) {
  const ref = useRef<Group>(null);
  const mat = useRoomMaterial()("glow", { color: "#FFF4D6", opacity: 0.85 });
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const m = motion.current;
    const k = m.hint && !m.disabled ? hintEnvelope(m.now, offset) : 0;
    const s = Math.max(0.0001, k * size);
    g.scale.set(s, s, s);
    g.rotation.z = m.now * 0.8;
    g.visible = k > 0.01;
  });
  return (
    <group ref={ref} position={position} visible={false}>
      <mesh geometry={star()} material={mat} renderOrder={5} />
    </group>
  );
}
