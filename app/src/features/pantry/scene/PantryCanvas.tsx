/* eslint-disable react/no-unknown-property -- R3F JSX props (args, attach, intensity, ...) are valid three.js props */
/**
 * Web canvas (Metro picks PantryCanvas.native.tsx on iOS/Android). Plain `@react-three/fiber` Canvas filling its parent.
 * sRGB output, dpr capped at 2; clear colour, fog, tone mapping, shadows and full-screen effects follow the active
 * theme (cozy: ACES, PCF shadows, warm wall clear colour) through ThemeCanvasSetup.
 */
import { Canvas } from "@react-three/fiber";
import { useCallback, type WheelEvent } from "react";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";

import { themeCanvasProps } from "../../theme/canvas";
import { useSceneTheme } from "../../theme/ThemeProvider";
import { CAMERA_FOV, MAX_DPR, type PantryCanvasProps } from "./sceneConfig";
import { ThemeCanvasSetup } from "./ThemeCanvasSetup";

export type { PantryCanvasProps } from "./sceneConfig";

export function PantryCanvas({ children, active = true, onWheel, testID }: PantryCanvasProps) {
  const theme = useSceneTheme();
  const cp = themeCanvasProps(theme);
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
    <View style={[styles.fill, { backgroundColor: cp.background }]} testID={testID}>
      <Canvas
        style={canvasStyle}
        dpr={[1, MAX_DPR]}
        frameloop={active ? "always" : "never"}
        shadows={cp.shadows}
        camera={{ fov: CAMERA_FOV, near: 0.05, far: 60, position: [0, 1.8, 9] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = cp.toneMapping;
          gl.toneMappingExposure = cp.toneMappingExposure;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.localClippingEnabled = true;
        }}
        onWheel={handleWheel}
      >
        <ThemeCanvasSetup theme={theme} />
        {children}
      </Canvas>
    </View>
  );
}

const canvasStyle = { position: "absolute", inset: 0, touchAction: "none" } as const;

const styles = StyleSheet.create({ fill: { flex: 1, overflow: "hidden" } });
