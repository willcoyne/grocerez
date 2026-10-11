/* eslint-disable react-hooks/immutability -- the rig mutates the three.js camera and shared scroll refs in useFrame by design */
/**
 * Shopper-eye camera: stands in the aisle at eye height, looks slightly down at the gondola and walks along x with the
 * aisle scroll. Keeps the scroll bounds and the px→world factor in sync with the viewport, and publishes the camera x
 * for the cart (which rides along in front of the shopper).
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import type * as THREE from "three";

import { aisleScrollBounds, cameraDistance, EYE_Y, halfWidthAt, LOOK_Y, type AisleLayout } from "./layout";
import type { AisleScroll } from "./useAisleScroll";

export type CameraBus = { x: number; dist: number; aspect: number };

export function AisleCamera({
  scroll,
  layout,
  bus,
}: {
  scroll: AisleScroll;
  layout: Pick<AisleLayout, "start" | "end">;
  bus: MutableRefObject<CameraBus>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const init = useRef(false);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 1 / 10);
    const aspect = size.width / Math.max(1, size.height);
    const b = aisleScrollBounds(layout, aspect);
    scroll.bounds.current.min = b.min;
    scroll.bounds.current.max = b.max;
    if (!init.current) {
      init.current = true;
      scroll.state.current.y = b.min;
    }
    const dist = cameraDistance(aspect);
    scroll.pxToWorld.current = (halfWidthAt(dist, aspect) * 2) / Math.max(1, size.width);
    scroll.step(dt);
    const x = scroll.state.current.y;
    camera.position.set(x, EYE_Y, dist);
    camera.lookAt(x, LOOK_Y, 0);
    bus.current.x = x;
    bus.current.dist = dist;
    bus.current.aspect = aspect;
  });
  return null;
}
