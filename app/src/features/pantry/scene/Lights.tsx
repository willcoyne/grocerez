/* eslint-disable react/no-unknown-property -- R3F JSX props (args, attach, intensity, ...) are valid three.js props */
/**
 * Warm key (the only shadow caster, small map) + soft fill + hemisphere bounce. The key light and its shadow camera
 * follow the camera's height so shelves deep down the column still get soft shadows. The cooler fridge/freezer light
 * lives with the shelves (scene/shelves). Colours / intensities / shadow casting come from the active theme
 * (themeLights; cozy reproduces the original values).
 */
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { themeLights } from "../../theme/canvas";
import { useSceneTheme } from "../../theme/ThemeProvider";
import { SHADOW_MAP_SIZE } from "./sceneConfig";

const KEY_OFFSET = new THREE.Vector3(-2.6, 3.4, 5.2);
const FILL_OFFSET = new THREE.Vector3(3.2, 1.2, 4.5);

export function Lights() {
  const L = themeLights(useSceneTheme());
  const key = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const k = key.current;
    if (!k) return;
    k.target = target;
    const cam = k.shadow.camera;
    cam.left = -3.2;
    cam.right = 3.2;
    cam.top = 3.4;
    cam.bottom = -3.4;
    cam.near = 0.5;
    cam.far = 16;
    cam.layers.enableAll();
    cam.updateProjectionMatrix();
    if (fill.current) fill.current.target = target;
  }, [target]);

  useFrame(({ camera }) => {
    // Track the point the camera looks at (x/y), keeping the light direction fixed.
    const fy = camera.position.y;
    const fx = camera.position.x;
    target.position.set(fx, fy - 0.4, -0.4);
    target.updateMatrixWorld();
    key.current?.position.set(fx + KEY_OFFSET.x, fy + KEY_OFFSET.y, KEY_OFFSET.z);
    fill.current?.position.set(fx + FILL_OFFSET.x, fy + FILL_OFFSET.y, FILL_OFFSET.z);
  });

  return (
    <>
      <primitive object={target} />
      <hemisphereLight key={`${L.hemisphere.sky}|${L.hemisphere.ground}`} args={[L.hemisphere.sky, L.hemisphere.ground, L.hemisphere.intensity]} />
      <ambientLight color={L.ambient.color} intensity={L.ambient.intensity} />
      <directionalLight
        ref={key}
        color={L.key.color}
        intensity={L.key.intensity}
        castShadow={L.key.castShadow}
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
        shadow-radius={4}
      />
      <directionalLight ref={fill} color={L.fill.color} intensity={L.fill.intensity} />
    </>
  );
}
