/* eslint-disable react/no-unknown-property -- R3F JSX props (args, attach, intensity, ...) are valid three.js props */
/**
 * Native canvas: `@react-three/fiber/native` renders through expo-gl. Same look as the web canvas (PantryCanvas.tsx),
 * themed through ThemeCanvasSetup; expo-gl always renders at the device pixel ratio, so the dpr cap only applies on web.
 */
import { Canvas } from "@react-three/fiber/native";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";

import { themeCanvasProps } from "../../theme/canvas";
import { useSceneTheme } from "../../theme/ThemeProvider";
import { CAMERA_FOV, type PantryCanvasProps } from "./sceneConfig";
import { ThemeCanvasSetup } from "./ThemeCanvasSetup";

export type { PantryCanvasProps } from "./sceneConfig";

export function PantryCanvas({ children, active = true, testID }: PantryCanvasProps) {
  const theme = useSceneTheme();
  const cp = themeCanvasProps(theme);
  return (
    <View style={[styles.fill, { backgroundColor: cp.background }]} testID={testID} collapsable={false}>
      <Canvas
        style={StyleSheet.absoluteFill}
        frameloop={active ? "always" : "never"}
        shadows={cp.shadows}
        camera={{ fov: CAMERA_FOV, near: 0.05, far: 60, position: [0, 1.8, 9] }}
        onCreated={({ gl }) => {
          gl.toneMapping = cp.toneMapping;
          gl.toneMappingExposure = cp.toneMappingExposure;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.localClippingEnabled = true;
        }}
      >
        <ThemeCanvasSetup theme={theme} />
        {children}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, overflow: "hidden" } });
