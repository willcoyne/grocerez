/* eslint-disable react/no-unknown-property -- R3F JSX props */
/**
 * The room around the shelves: glossy pale tile floor with soft light reflections, a back wall with a brand-green band
 * above the gondolas, the ceiling with fluorescent light strips, the entrance endcap with the store logo, and filler
 * shelving stocked with generic boxes past both ends so the aisle feels endless. Materials follow the active theme.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { washColor } from "../../pantry/scene/sceneTheme";
import { createThemedMaterial } from "../../theme/materials";
import { useSceneTheme } from "../../theme/ThemeProvider";

import { CEILING_Y, ENTRANCE_W, FILLER_W, GONDOLA_TOP, LEVEL_Y, SHELF_DEPTH } from "./layout";
import { Gondola } from "./Gondola";
import { getStoreGeometries, getStoreMaterials, noRaycast } from "./materials";
import { StoreLogo } from "./Signage";

const TILE = 0.6; // metres per tile (texture holds 2×2 tiles)
const STRIP_EVERY = 1.8;
const STRIP_LEN = 1.3;
const STRIP_ROWS = [0.7, 2.4, 4.3];

export const StoreEnvironment = memo(function StoreEnvironment({ start, end }: { start: number; end: number }) {
  const g = getStoreGeometries();
  const m = getStoreMaterials(useSceneTheme());
  const x0 = start - FILLER_W - 8;
  const x1 = end + FILLER_W + 8;
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const floorZ0 = -SHELF_DEPTH - 0.1;
  const floorZ1 = 12;
  const floorD = floorZ1 - floorZ0;

  useLayoutEffect(() => {
    m.floorTex.repeat.set(w / (TILE * 2), floorD / (TILE * 2));
    m.floorTex.offset.set(x0 / (TILE * 2), 0);
  }, [m.floorTex, w, floorD, x0]);

  const strips = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    const first = Math.floor(x0 / STRIP_EVERY) * STRIP_EVERY;
    for (let x = first; x < x1; x += STRIP_EVERY) for (const z of STRIP_ROWS) out.push({ x, z });
    return out;
  }, [x0, x1]);

  return (
    <group>
      {/* floor */}
      <mesh
        geometry={g.plane}
        material={m.floor}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cx, 0, (floorZ0 + floorZ1) / 2]}
        scale={[w, floorD, 1]}
        receiveShadow
        raycast={noRaycast}
      />
      {/* fake reflections on the glossy tile: a soft glow under every light strip and a faint shadow of the shelves */}
      {strips.map((s) => (
        <mesh
          key={`glow-${s.x}|${s.z}`}
          geometry={g.plane}
          material={m.floorGlow}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[s.x, 0.002, s.z]}
          scale={[STRIP_LEN * 1.5, 0.9, 1]}
          raycast={noRaycast}
        />
      ))}
      <mesh
        geometry={g.plane}
        material={m.shelfReflection}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cx, 0.003, 0.12]}
        scale={[w * 1.4, 0.5, 1]}
        raycast={noRaycast}
      />
      {/* back wall above the gondolas */}
      <mesh geometry={g.plane} material={m.wall} position={[cx, CEILING_Y / 2, -SHELF_DEPTH - 0.06]} scale={[w, CEILING_Y, 1]} raycast={noRaycast} />
      <mesh geometry={g.plane} material={m.wallBand} position={[cx, GONDOLA_TOP + 0.42, -SHELF_DEPTH - 0.05]} scale={[w, 0.14, 1]} raycast={noRaycast} />
      {/* ceiling + light strips */}
      <mesh
        geometry={g.plane}
        material={m.ceiling}
        rotation={[Math.PI / 2, 0, 0]}
        position={[cx, CEILING_Y, (floorZ0 + floorZ1) / 2]}
        scale={[w, floorD, 1]}
        raycast={noRaycast}
      />
      {strips.map((s) => (
        <group key={`${s.x}|${s.z}`} position={[s.x, CEILING_Y - 0.05, s.z]}>
          <mesh geometry={g.unitBox} material={m.tubeHousing} scale={[STRIP_LEN + 0.08, 0.05, 0.24]} raycast={noRaycast} />
          <mesh geometry={g.unitBox} material={m.tube} position={[0, -0.03, 0]} scale={[STRIP_LEN, 0.02, 0.17]} raycast={noRaycast} />
        </group>
      ))}
      {/* entrance endcap + logo, filler shelving at both ends */}
      <Filler x0={-ENTRANCE_W} x1={0} seed={3} />
      <StoreLogo x={-ENTRANCE_W / 2} />
      <Filler x0={start - FILLER_W} x1={start} seed={1} />
      <Filler x0={end} x1={end + FILLER_W} seed={2} />
    </group>
  );
});

const FILLER_COLORS = ["#E57373", "#FFB74D", "#FFF176", "#81C784", "#64B5F6", "#BA68C8", "#F06292", "#A1887F", "#4DB6AC"];

/** Empty-looking shelving would break the illusion, so fillers carry instanced generic boxes (not tappable). */
function Filler({ x0, x1, seed }: { x0: number; x1: number; seed: number }) {
  const theme = useSceneTheme();
  const g = getStoreGeometries();
  const ref = useRef<THREE.InstancedMesh>(null);
  const boxes = useMemo(() => {
    const out: { x: number; y: number; z: number; w: number; h: number; d: number; c: string }[] = [];
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (const y of LEVEL_Y) {
      let x = x0 + 0.08;
      while (x < x1 - 0.2) {
        const w = 0.12 + rnd() * 0.12;
        const h = 0.18 + rnd() * 0.2;
        out.push({ x: x + w / 2, y: y + h / 2, z: -0.2, w, h, d: 0.22, c: FILLER_COLORS[Math.floor(rnd() * FILLER_COLORS.length)] });
        x += w + 0.02 + rnd() * 0.03;
      }
    }
    return out;
  }, [x0, x1, seed]);
  // instance colours carry the box colours (washed for the sketch theme); the material is white in the theme's style
  const mat = useMemo(() => createThemedMaterial(theme, "generic", { roughness: 0.6, color: "#FFFFFF" }), [theme]);
  useEffect(() => () => mat.dispose(), [mat]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    boxes.forEach((b, i) => {
      o.position.set(b.x, b.y, b.z);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(washColor(theme, b.c)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [boxes, theme, mat]);
  return (
    <group>
      <Gondola x0={x0} x1={x1} theme="shelf" />
      <instancedMesh ref={ref} args={[g.roundBox, mat, boxes.length]} castShadow={false} raycast={noRaycast} />
    </group>
  );
}
