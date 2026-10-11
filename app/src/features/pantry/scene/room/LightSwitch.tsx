/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, position...) */
// Light switch (SPEC Round 3, LEFT wall near the pantry ≈ (-1.55, 1.35)). Tap flips the toggle and opens the
// Appearance (theme) sheet via onPress.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

import { Glint, hintEnvelope, Parts, pressBounce, PropHitBoxes, useRoomProp, type RoomPropProps } from "./interaction";
import { HIT, LIGHT_SWITCH, WALL_Z } from "./layout";
import { getSwitchShared, PLATE_DEPTH, TOGGLE, toggleAngle } from "./parts/lightSwitch";

export type LightSwitchProps = RoomPropProps;

export function LightSwitch({ onPress, hint = false, disabled = false }: LightSwitchProps) {
  const shared = getSwitchShared();
  const on = useRef(true);
  const flip = useRef(1); // smoothed 0 (off) .. 1 (on)
  const { motion, handlers } = useRoomProp({
    onPress: () => {
      on.current = !on.current;
      onPress();
    },
    hint,
    disabled,
  });
  const plate = useRef<Group>(null);
  const lever = useRef<Group>(null);

  useFrame((_, delta) => {
    const m = motion.current;
    const t = m.now;
    const target = on.current ? 1 : 0;
    // snappy with a tiny overshoot feel: critically-ish damped approach
    flip.current += (target - flip.current) * Math.min(1, Math.min(delta, 0.1) * 18);
    const h = m.hint && !m.disabled ? hintEnvelope(t, 3.1) : 0;
    if (lever.current) lever.current.rotation.x = toggleAngle(flip.current) + 0.06 * h * Math.sin(t * 14);
    if (plate.current) {
      const s = 1 + 0.05 * m.hoverK - 0.04 * pressBounce(t - m.pressedAt);
      plate.current.scale.set(s, s, 1);
      plate.current.position.z = WALL_Z + 0.004 * m.hoverK;
    }
  });

  return (
    <group name="LightSwitch">
      <group ref={plate} position={[LIGHT_SWITCH.x, LIGHT_SWITCH.y, WALL_Z]}>
        <Parts parts={shared.plate} />
        <group ref={lever} position={TOGGLE.pivot} rotation={[TOGGLE.on, 0, 0]}>
          <Parts parts={shared.lever} />
        </group>
        <Glint position={[LIGHT_SWITCH.w / 2 - 0.006, LIGHT_SWITCH.h / 2 - 0.006, PLATE_DEPTH + 0.01]} size={0.03} motion={motion} offset={3.1} />
      </group>
      <PropHitBoxes name="light-switch" boxes={[HIT.lightSwitch]} handlers={handlers} disabled={disabled} />
    </group>
  );
}
