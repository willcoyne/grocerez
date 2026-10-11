/* eslint-disable react/no-unknown-property -- R3F JSX props (args, attach, ...) are valid three.js props */
/**
 * Web canvas for the store (Metro picks StoreCanvas.native.tsx on iOS/Android). Same setup as the pantry canvas
 * (ACES, sRGB, PCF shadows, dpr ≤ 2) with a bright, cool supermarket clear colour and fog.
 */
import { Canvas } from "@react-three/fiber";
import { useCallback, type WheelEvent } from "react";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";

import { CAMERA_FOV, MAX_DPR, STORE_SKY, type StoreCanvasProps } from "./storeConfig";

export type { StoreCanvasProps } from "./storeConfig";

export function StoreCanvas({ children, active = true, onWheel, testID }: StoreCanvasProps) {
  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (!onWheel) return;
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      onWheel(d * scale);
    },
    [onWheel],
  );
  return (
    <View style={styles.fill} testID={testID}>
      <Canvas
        style={canvasStyle}
        dpr={[1, MAX_DPR]}
        frameloop={active ? "always" : "never"}
        shadows={{ enabled: true, type: THREE.PCFShadowMap }}
        camera={{ fov: CAMERA_FOV, near: 0.05, far: 80, position: [0, 1.6, 7] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
        onWheel={handleWheel}
      >
        <color attach="background" args={[STORE_SKY]} />
        <fog attach="fog" args={[STORE_SKY, 16, 40]} />
        {children}
      </Canvas>
    </View>
  );
}

const canvasStyle = { position: "absolute", inset: 0, touchAction: "none" } as const;

const styles = StyleSheet.create({ fill: { flex: 1, overflow: "hidden", backgroundColor: STORE_SKY } });
