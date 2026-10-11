/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, position, ...) are valid three.js props */
/**
 * Fridge / freezer theming for an ApplianceBlock: steel header with a temperature readout and an LED strip, liner
 * walls (white for the fridge, frosted ice-blue for the freezer), steel footer, plus freezer sparkles and mist.
 * Lights live in ShelfColumn (always mounted, so the light count never changes and shaders never recompile).
 */
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import {
  APPLIANCE_FOOTER_HEIGHT,
  APPLIANCE_HEADER_HEIGHT,
  type ApplianceBlock,
  DEPTH,
  INNER_WIDTH,
} from "./layout";
import { shelfAssets } from "./materials";
import { ShelfLabel } from "./ShelfLabel";

const HALF = INNER_WIDTH / 2;

export const Appliance = memo(function Appliance({ block }: { block: ApplianceBlock }) {
  const { geometries: G, materials: M } = shelfAssets();
  const fridge = block.theme === "fridge";
  const wallMat = fridge ? M.fridgeWall : M.frostWall;
  const rowsH = block.rowsTop - block.rowsBottom;
  const rowsMidY = (block.rowsTop + block.rowsBottom) / 2;
  const headerY = block.top - APPLIANCE_HEADER_HEIGHT / 2;
  const footerY = block.bottom + APPLIANCE_FOOTER_HEIGHT / 2;
  const fullH = block.top - block.bottom;
  const fullMidY = (block.top + block.bottom) / 2;

  return (
    <group>
      {/* liner back wall, covering header→footer so no wood peeks through */}
      <mesh
        geometry={G.unitPlane}
        material={wallMat}
        position={[0, fullMidY, -DEPTH + 0.004]}
        scale={[INNER_WIDTH, fullH, 1]}
        receiveShadow
      />
      {/* liner side walls */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          geometry={G.unitBox}
          material={wallMat}
          position={[side * (HALF - 0.006), fullMidY, -DEPTH / 2]}
          scale={[0.012, fullH, DEPTH]}
          receiveShadow
        />
      ))}

      {/* steel header frame */}
      <mesh
        geometry={G.header}
        material={M.steel}
        position={[0, headerY, -0.025]}
        scale={[1, APPLIANCE_HEADER_HEIGHT, 1]}
        castShadow
      />
      {/* dark readout panel + temperature */}
      <mesh
        geometry={G.unitBox}
        material={M.steelDark}
        position={[0, headerY + 0.012, 0.006]}
        scale={[0.34, 0.1, 0.01]}
      />
      <mesh
        geometry={G.unitBox}
        material={displayMaterial()}
        position={[0, headerY + 0.012, 0.0115]}
        scale={[0.31, 0.078, 0.002]}
      />
      <ShelfLabel
        text={fridge ? "3°C" : "-18°C"}
        size={0.042}
        depth={0.002}
        position={[0, headerY + 0.012, 0.0125]}
        material={readoutMaterial()}
      />
      {/* tiny brand badge dots */}
      {[-0.62, 0.62].map((x) => (
        <mesh
          key={x}
          geometry={G.unitBox}
          material={M.chrome}
          position={[x, headerY + 0.012, 0.006]}
          scale={[0.08, 0.012, 0.01]}
        />
      ))}
      {/* LED strip under the header: the "light source" of the compartment */}
      <mesh
        geometry={G.unitBox}
        material={fridge ? M.led : M.iceLed}
        position={[0, block.rowsTop - 0.004, -0.12]}
        scale={[INNER_WIDTH - 0.08, 0.008, 0.03]}
      />

      {/* steel footer */}
      <mesh
        geometry={G.unitBox}
        material={M.steel}
        position={[0, footerY, -0.02]}
        scale={[INNER_WIDTH + 0.01, APPLIANCE_FOOTER_HEIGHT, 0.05]}
        castShadow
      />
      {/* door gasket hint: thin dark line at the very front of the liners */}
      {[-1, 1].map((side) => (
        <mesh
          key={`g${side}`}
          geometry={G.unitBox}
          material={M.steelDark}
          position={[side * (HALF - 0.004), rowsMidY, 0.004]}
          scale={[0.01, rowsH, 0.008]}
        />
      ))}

      {!fridge && <FreezerAtmosphere block={block} />}
    </group>
  );
});

let displayMat: THREE.MeshStandardMaterial | null = null;
function displayMaterial() {
  if (!displayMat) displayMat = new THREE.MeshStandardMaterial({ color: "#0E1A22", roughness: 0.25, metalness: 0.2 });
  return displayMat;
}
let readoutMat: THREE.MeshStandardMaterial | null = null;
function readoutMaterial() {
  if (!readoutMat) {
    readoutMat = new THREE.MeshStandardMaterial({ color: "#8FE9FF", emissive: "#5CDBFF", emissiveIntensity: 1.2 });
  }
  return readoutMat;
}

// ---------------------------------------------------------------------------------------------------------------

const SPARKLES = 70;
const MISTS = 3;

/** Slowly drifting ice-crystal sparkles (one Points draw call) and a few soft mist sprites. */
function FreezerAtmosphere({ block }: { block: ApplianceBlock }) {
  const { geometries: G, materials: M } = shelfAssets();
  const points = useRef<THREE.Points>(null);
  const mists = useRef<(THREE.Mesh | null)[]>([]);
  const top = block.rowsTop;
  const bottom = block.rowsBottom;
  const h = top - bottom;

  const { geometry, speeds, phases } = useMemo(() => {
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const pos = new Float32Array(SPARKLES * 3);
    const sp = new Float32Array(SPARKLES);
    const ph = new Float32Array(SPARKLES);
    for (let i = 0; i < SPARKLES; i++) {
      pos[i * 3] = (rand() * 2 - 1) * (HALF - 0.04);
      pos[i * 3 + 1] = bottom + rand() * h;
      pos[i * 3 + 2] = -DEPTH + 0.04 + rand() * (DEPTH + 0.02);
      sp[i] = 0.02 + rand() * 0.05;
      ph[i] = rand() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geometry: g, speeds: sp, phases: ph };
  }, [bottom, h]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const step = Math.min(dt, 0.05);
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < SPARKLES; i++) {
      let y = arr[i * 3 + 1] - speeds[i] * step;
      if (y < bottom) y += h;
      arr[i * 3 + 1] = y;
      arr[i * 3] += Math.sin(t * 0.6 + phases[i]) * 0.0006;
    }
    attr.needsUpdate = true;
    const mats = shelfAssets().materials;
    mats.sparkle.opacity = 0.7 + Math.sin(t * 2.1) * 0.2;
    mats.mist.opacity = 0.14 + Math.sin(t * 0.4) * 0.04;
    mists.current.forEach((m, i) => {
      if (m) m.position.x = Math.sin(t * 0.15 + i * 2.1) * 0.25;
    });
  });

  return (
    <group>
      <points ref={points} geometry={geometry} material={M.sparkle} frustumCulled={false} renderOrder={3} />
      {Array.from({ length: MISTS }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            mists.current[i] = m;
          }}
          geometry={G.unitPlane}
          material={M.mist}
          // low, soft bands of mist hugging the back wall behind the items, kept inside the compartment
          position={[0, bottom + 0.12 + ((i + 0.5) / MISTS) * Math.max(0, h - 0.3), -DEPTH + 0.06 + i * 0.03]}
          scale={[1.4, Math.min(0.3, h / 2), 1]}
          renderOrder={2}
        />
      ))}
    </group>
  );
}
