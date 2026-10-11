/* eslint-disable react/no-unknown-property -- R3F JSX props (args, attach, intensity, ...) are valid three.js props */
/**
 * Native canvas: `@react-three/fiber/native` renders through expo-gl. Same look as the web canvas (PantryCanvas.tsx);
 * expo-gl always renders at the device pixel ratio, so the dpr cap only applies on web.
 */
import { Canvas } from "@react-three/fiber/native";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";

import { CAMERA_FOV, WALL_COLOR, type PantryCanvasProps } from "./sceneConfig";

export type { PantryCanvasProps } from "./sceneConfig";

export function PantryCanvas({ children, active = true, testID }: PantryCanvasProps) {
  return (
    <View style={styles.fill} testID={testID} collapsable={false}>
      <Canvas
        style={StyleSheet.absoluteFill}
        frameloop={active ? "always" : "never"}
        shadows={{ enabled: true, type: THREE.PCFShadowMap }}
        camera={{ fov: CAMERA_FOV, near: 0.05, far: 60, position: [0, 1.8, 9] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.localClippingEnabled = true;
        }}
      >
        <color attach="background" args={[WALL_COLOR]} />
        <fog attach="fog" args={[WALL_COLOR, 14, 30]} />
        {children}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, overflow: "hidden", backgroundColor: WALL_COLOR } });
