/* eslint-disable react/no-unknown-property -- R3F JSX props (args, attach, ...) are valid three.js props */
/** Native store canvas: `@react-three/fiber/native` through expo-gl. Same look as StoreCanvas.tsx. */
import { Canvas } from "@react-three/fiber/native";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";

import { CAMERA_FOV, STORE_SKY, type StoreCanvasProps } from "./storeConfig";

export type { StoreCanvasProps } from "./storeConfig";

export function StoreCanvas({ children, active = true, testID }: StoreCanvasProps) {
  return (
    <View style={styles.fill} testID={testID} collapsable={false}>
      <Canvas
        style={StyleSheet.absoluteFill}
        frameloop={active ? "always" : "never"}
        shadows={{ enabled: true, type: THREE.PCFShadowMap }}
        camera={{ fov: CAMERA_FOV, near: 0.05, far: 80, position: [0, 1.6, 7] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <color attach="background" args={[STORE_SKY]} />
        <fog attach="fog" args={[STORE_SKY, 16, 40]} />
        {children}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, overflow: "hidden", backgroundColor: STORE_SKY } });
