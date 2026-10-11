/* eslint-disable react/no-unknown-property -- R3F JSX props */
/**
 * Bright, even supermarket light: cool-white hemisphere + ambient, one overhead key (the only shadow caster, small map)
 * that follows the shopper along the aisle, and a soft frontal fill so shelf faces are readable.
 */
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { SHADOW_MAP_SIZE } from "./storeConfig";

export function StoreLights() {
  const key = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const k = key.current;
    if (!k) return;
    k.target = target;
    const cam = k.shadow.camera;
    cam.left = -4.5;
    cam.right = 4.5;
    cam.top = 3;
    cam.bottom = -3;
    cam.near = 0.5;
    cam.far = 14;
    cam.updateProjectionMatrix();
    if (fill.current) fill.current.target = target;
  }, [target]);

  useFrame(({ camera }) => {
    const x = camera.position.x;
    target.position.set(x, 0.8, -0.2);
    target.updateMatrixWorld();
    key.current?.position.set(x + 1.2, 6, 3.2);
    fill.current?.position.set(x - 1.5, 2.2, 6);
  });

  return (
    <>
      <primitive object={target} />
      <hemisphereLight args={["#FFFFFF", "#D9DEDC", 1.1]} />
      <ambientLight color="#F4F8FF" intensity={0.35} />
      <directionalLight
        ref={key}
        color="#FFFFFF"
        intensity={1.6}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
        shadow-radius={4}
      />
      <directionalLight ref={fill} color="#F2F7FF" intensity={0.7} />
    </>
  );
}
