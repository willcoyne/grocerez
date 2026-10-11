/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, position, ...) are valid three.js props */
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type InstanceXform = {
  p: [number, number, number];
  s?: [number, number, number];
  /** rotation about z (radians) */
  rz?: number;
};

type Props = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  instances: InstanceXform[];
  /** capacity; the mesh is re-created only if this grows */
  max?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  renderOrder?: number;
};

const tmp = new THREE.Object3D();

/**
 * One draw call for many copies of the same shelf part. Count/matrices update when the mounted window moves;
 * capacity is rounded up so scrolling doesn't re-create the mesh.
 */
export function Instanced({ geometry, material, instances, max, castShadow, receiveShadow, renderOrder }: Props) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const capacity = useMemo(() => {
    const need = Math.max(max ?? 0, instances.length, 1);
    return Math.ceil(need / 16) * 16;
  }, [max, instances.length]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    instances.forEach((inst, i) => {
      tmp.position.set(inst.p[0], inst.p[1], inst.p[2]);
      tmp.rotation.set(0, 0, inst.rz ?? 0);
      if (inst.s) tmp.scale.set(inst.s[0], inst.s[1], inst.s[2]);
      else tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
    });
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [instances, capacity]);

  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      args={[geometry, material, capacity]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      renderOrder={renderOrder}
      // mounted window is already virtualised; instance bounds would otherwise need recomputing every update
      frustumCulled={false}
    />
  );
}
