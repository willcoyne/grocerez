/**
 * Web canvas for the store (Metro picks StoreCanvas.native.tsx on iOS/Android). Same setup as the pantry canvas
 * (sRGB, dpr ≤ 2; tone mapping, shadows and full-screen effects from the active theme) with the theme's store look
 * (cozy: a bright, cool supermarket clear colour and fog, see storeTheme.ts).
 */
import { Canvas } from "@react-three/fiber";
import { useCallback, type WheelEvent } from "react";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";

import { ThemeCanvasSetup } from "../../pantry/scene/ThemeCanvasSetup";
import { themeCanvasProps } from "../../theme/canvas";
import { useSceneTheme } from "../../theme/ThemeProvider";
import { CAMERA_FOV, MAX_DPR, type StoreCanvasProps } from "./storeConfig";
import { storeCanvasLook } from "./storeTheme";

export type { StoreCanvasProps } from "./storeConfig";

export function StoreCanvas({ children, active = true, onWheel, testID }: StoreCanvasProps) {
  const theme = useSceneTheme();
  const cp = themeCanvasProps(theme);
  const look = storeCanvasLook(theme);
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
    <View style={[styles.fill, { backgroundColor: look.background }]} testID={testID}>
      <Canvas
        style={canvasStyle}
        dpr={[1, MAX_DPR]}
        frameloop={active ? "always" : "never"}
        shadows={cp.shadows}
        camera={{ fov: CAMERA_FOV, near: 0.05, far: 80, position: [0, 1.6, 7] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = cp.toneMapping;
          gl.toneMappingExposure = look.exposure;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
        onWheel={handleWheel}
      >
        <ThemeCanvasSetup theme={theme} background={look.background} fog={look.fog} exposure={look.exposure} />
        {children}
      </Canvas>
    </View>
  );
}

const canvasStyle = { position: "absolute", inset: 0, touchAction: "none" } as const;

const styles = StyleSheet.create({ fill: { flex: 1, overflow: "hidden" } });
