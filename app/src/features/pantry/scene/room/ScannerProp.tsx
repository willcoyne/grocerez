/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, position...) */
// Scanner (SPEC Round 3, on the stool beside the plant): a gun-style barcode scanner lying on the seat with a faint red
// scan line. Tap → onPress (the screen navigates to /scanner).
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

import { Glint, hintEnvelope, Parts, pressBounce, PropHitBoxes, useRoomProp, type RoomPropProps } from "./interaction";
import { HIT, SCANNER, STOOL } from "./layout";
import { getScannerShared, SCANNER_THICKNESS } from "./parts/scanner";

export type ScannerPropProps = RoomPropProps;

export function ScannerProp({ onPress, hint = false, disabled = false }: ScannerPropProps) {
  const shared = getScannerShared();
  const { motion, handlers } = useRoomProp({ onPress, hint, disabled });
  const body = useRef<Group>(null);
  const beam = useRef<Group>(null);

  useFrame(() => {
    const m = motion.current;
    const t = m.now;
    const h = m.hint && !m.disabled ? hintEnvelope(t, 2.2) : 0;
    const press = pressBounce(t - m.pressedAt);
    if (body.current) {
      // hint: a little hop + wiggle on the seat; hover: lifts a hair
      body.current.position.y = 0.012 * h * Math.abs(Math.sin(t * 9)) + 0.006 * m.hoverK + 0.006 * Math.abs(press);
      body.current.rotation.y = 0.05 * h * Math.sin(t * 11);
    }
    if (beam.current) {
      // faint flicker; brighter (wider) sweep on the hint beat / hover
      const f = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7.3);
      beam.current.scale.set(1, 1, f * (1 + 0.35 * h + 0.2 * m.hoverK));
    }
  });

  return (
    <group name="ScannerProp">
      <group position={[SCANNER.x, STOOL.seatTop, SCANNER.z]} rotation={[0, SCANNER.yaw, 0]} scale={SCANNER.scale}>
        <group ref={body}>
          <Parts parts={shared.body} />
          <group ref={beam}>
            <Parts parts={shared.beam} />
          </group>
          <Glint position={[-0.06, SCANNER_THICKNESS + 0.01, 0.0]} size={0.035} motion={motion} offset={2.2} />
        </group>
      </group>
      <PropHitBoxes name="scanner" boxes={[HIT.scanner]} handlers={handlers} disabled={disabled} />
    </group>
  );
}
