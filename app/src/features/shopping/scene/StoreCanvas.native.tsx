/** Native store canvas: `@react-three/fiber/native` through expo-gl. Same (themed) look as StoreCanvas.tsx. */
import { Canvas } from "@react-three/fiber/native";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";

import { ThemeCanvasSetup } from "../../pantry/scene/ThemeCanvasSetup";
import { themeCanvasProps } from "../../theme/canvas";
import { useSceneTheme } from "../../theme/ThemeProvider";
import { CAMERA_FOV, type StoreCanvasProps } from "./storeConfig";
import { storeCanvasLook } from "./storeTheme";

export type { StoreCanvasProps } from "./storeConfig";

export function StoreCanvas({ children, active = true, testID }: StoreCanvasProps) {
  const theme = useSceneTheme();
  const cp = themeCanvasProps(theme);
  const look = storeCanvasLook(theme);
  return (
    <View style={[styles.fill, { backgroundColor: look.background }]} testID={testID} collapsable={false}>
      <Canvas
        style={StyleSheet.absoluteFill}
        frameloop={active ? "always" : "never"}
        shadows={cp.shadows}
        camera={{ fov: CAMERA_FOV, near: 0.05, far: 80, position: [0, 1.6, 7] }}
        onCreated={({ gl }) => {
          gl.toneMapping = cp.toneMapping;
          gl.toneMappingExposure = look.exposure;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <ThemeCanvasSetup theme={theme} background={look.background} fog={look.fog} exposure={look.exposure} />
        {children}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, overflow: "hidden" } });
