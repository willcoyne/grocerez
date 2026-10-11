/* eslint-disable react/no-unknown-property -- R3F JSX props (args, attach, intensity, ...) are valid three.js props */
/**
 * Web canvas (Metro picks PantryCanvas.native.tsx on iOS/Android). Plain `@react-three/fiber` Canvas filling its parent.
 * ACES tone mapping + sRGB output, PCF shadows, dpr capped at 2, warm wall clear colour.
 */
import { Canvas } from "@react-three/fiber";
import { useCallback, type WheelEvent } from "react";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";

import { CAMERA_FOV, MAX_DPR, WALL_COLOR, type PantryCanvasProps } from "./sceneConfig";

export type { PantryCanvasProps } from "./sceneConfig";

export function PantryCanvas({ children, active = true, onWheel, testID }: PantryCanvasProps) {
  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (!onWheel) return;
      // deltaMode 1 = lines, 2 = pages; normalise to pixels.
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      onWheel(e.deltaY * scale);
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
        camera={{ fov: CAMERA_FOV, near: 0.05, far: 60, position: [0, 1.8, 9] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.localClippingEnabled = true;
        }}
        onWheel={handleWheel}
      >
        <color attach="background" args={[WALL_COLOR]} />
        <fog attach="fog" args={[WALL_COLOR, 14, 30]} />
        {children}
      </Canvas>
    </View>
  );
}

const canvasStyle = { position: "absolute", inset: 0, touchAction: "none" } as const;

const styles = StyleSheet.create({ fill: { flex: 1, overflow: "hidden", backgroundColor: WALL_COLOR } });
