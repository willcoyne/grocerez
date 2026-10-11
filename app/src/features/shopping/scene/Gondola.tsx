/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, position, ...) */
/**
 * One run of store shelving from x0 to x1 (front edge at z = 0, shelves going back to -SHELF_DEPTH), themed per aisle:
 * metal gondola with pegboard back (dry goods), green back + crates (produce), warm wood (bakery), white refrigerated
 * case with a cool light strip (dairy, meat & seafood) and a glass-door freezer case (frozen). Materials follow the
 * active theme (materials.ts).
 */
import { memo, useMemo } from "react";
import * as THREE from "three";

import { useSceneTheme } from "../../theme/ThemeProvider";
import type { AisleTheme } from "../mapping";
import { GONDOLA_TOP, LEVEL_Y, SHELF_DEPTH } from "./layout";
import { getStoreGeometries, getStoreMaterials, noRaycast, type StoreMaterials } from "./materials";

type Box = { pos: [number, number, number]; size: [number, number, number]; mat: THREE.Material; shadow?: boolean };

const DOOR_W = 0.92;

function boxesFor(x0: number, x1: number, theme: AisleTheme, m: StoreMaterials): Box[] {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const back =
    theme === "produce" ? m.produceBack : theme === "bakery" ? m.bakery : theme === "cooler" ? m.cooler : theme === "freezer" ? m.freezerBack : m.backPeg;
  const shelfMat = theme === "produce" ? m.crate : theme === "bakery" ? m.bakery : theme === "freezer" ? m.glass : m.shelf;
  const frame = theme === "cooler" || theme === "freezer" ? m.white : m.steel;
  const out: Box[] = [
    // kick plate
    { pos: [cx, 0.06, -SHELF_DEPTH / 2 + 0.02], size: [w, 0.12, SHELF_DEPTH], mat: m.steelDark },
    // back panel
    { pos: [cx, GONDOLA_TOP / 2, -SHELF_DEPTH - 0.02], size: [w, GONDOLA_TOP, 0.04], mat: back },
    // header
    { pos: [cx, GONDOLA_TOP + 0.05, -SHELF_DEPTH / 2], size: [w, 0.1, SHELF_DEPTH + 0.04], mat: frame, shadow: true },
    // uprights
    { pos: [x0 + 0.025, GONDOLA_TOP / 2, -SHELF_DEPTH / 2], size: [0.05, GONDOLA_TOP, SHELF_DEPTH], mat: frame },
    { pos: [x1 - 0.025, GONDOLA_TOP / 2, -SHELF_DEPTH / 2], size: [0.05, GONDOLA_TOP, SHELF_DEPTH], mat: frame },
  ];
  for (const y of LEVEL_Y) {
    out.push({ pos: [cx, y - 0.015, -SHELF_DEPTH / 2], size: [w - 0.04, 0.03, SHELF_DEPTH - 0.02], mat: shelfMat, shadow: theme !== "freezer" });
    // front price rail
    out.push({ pos: [cx, y - 0.035, 0.004], size: [w - 0.04, 0.05, 0.012], mat: theme === "produce" ? m.crate : m.steel });
  }
  if (theme === "produce") {
    // low crate fronts on each shelf
    for (const y of LEVEL_Y) out.push({ pos: [cx, y + 0.035, -0.012], size: [w - 0.06, 0.07, 0.02], mat: m.crate });
  }
  if (theme === "cooler") {
    out.push({ pos: [cx, GONDOLA_TOP - 0.03, -0.08], size: [w - 0.1, 0.025, 0.04], mat: m.coolerGlow });
    out.push({ pos: [cx, 0.16, 0.02], size: [w, 0.08, 0.05], mat: m.white });
  }
  if (theme === "freezer") {
    out.push({ pos: [cx, GONDOLA_TOP - 0.03, -0.08], size: [w - 0.1, 0.025, 0.04], mat: m.coolerGlow });
    // door frames: vertical mullions + top/bottom rails
    const doors = Math.max(1, Math.round(w / DOOR_W));
    const dw = w / doors;
    for (let i = 0; i <= doors; i++) out.push({ pos: [x0 + i * dw, 1.02, 0.05], size: [0.035, 1.84, 0.03], mat: m.white });
    out.push({ pos: [cx, 0.1, 0.05], size: [w, 0.04, 0.03], mat: m.white });
    out.push({ pos: [cx, 1.94, 0.05], size: [w, 0.04, 0.03], mat: m.white });
    for (let i = 0; i < doors; i++) {
      // handle near the right edge of each door
      out.push({ pos: [x0 + (i + 1) * dw - 0.08, 1.05, 0.085], size: [0.02, 0.5, 0.025], mat: m.steel });
    }
  }
  return out;
}

export const Gondola = memo(function Gondola({ x0, x1, theme }: { x0: number; x1: number; theme: AisleTheme }) {
  const g = getStoreGeometries();
  const m = getStoreMaterials(useSceneTheme());
  const boxes = useMemo(() => boxesFor(x0, x1, theme, m), [x0, x1, theme, m]);
  const w = x1 - x0;
  const doors = theme === "freezer" ? Math.max(1, Math.round(w / DOOR_W)) : 0;
  const dw = doors ? w / doors : 0;
  return (
    <group>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          geometry={g.unitBox}
          material={b.mat}
          position={b.pos}
          scale={b.size}
          castShadow={b.shadow ?? false}
          receiveShadow
          raycast={noRaycast}
        />
      ))}
      {Array.from({ length: doors }, (_, i) => (
        <group key={`door-${i}`} position={[x0 + (i + 0.5) * dw, 1.02, 0.052]}>
          <mesh geometry={g.plane} material={m.glass} scale={[dw - 0.04, 1.8, 1]} raycast={noRaycast} renderOrder={2} />
          {/* diagonal shine streak, so the glass reads as glass */}
          <mesh
            geometry={g.plane}
            material={m.glassShine}
            position={[-dw * 0.12, 0.25, 0.002]}
            rotation={[0, 0, -0.5]}
            scale={[0.06, 1.1, 1]}
            raycast={noRaycast}
            renderOrder={3}
          />
        </group>
      ))}
    </group>
  );
});
