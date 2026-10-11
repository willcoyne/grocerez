/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, position...) */
// "Me" station (SPEC Round 3, LEFT wall ≈ (-2.35, 1.9)): a framed chalkboard "MY PICKS" listing up to 3 of my
// preferences in chalk, with a chalk tray; beside it a wall hook with my apron, my polaroid clipped to the bib.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Group } from "three";

import { Glint, Parts, PropHitBoxes, pressBounce, hintEnvelope, useRoomProp, type RoomPropProps } from "./interaction";
import { HIT, ME_BOARD, ME_HOOK, WALL_Z } from "./layout";
import { disposeParts } from "./parts/common";
import { APRON_POLAROID, avatarColor, buildPicksText, buildPolaroid, getMeShared, pickLines, POLAROID } from "./parts/me";

export type MeStationProps = RoomPropProps & {
  /** my preferences; the first 3 are written in chalk (empty → "tap to add your faves!") */
  picks: string[];
  displayName: string;
  avatarInitial: string;
};

export function MeStation({ onPress, hint = false, disabled = false, picks, displayName, avatarInitial }: MeStationProps) {
  const shared = getMeShared();
  const { motion, handlers } = useRoomProp({ onPress, hint, disabled });
  const picksKey = pickLines(picks).join("\n");
  const picksParts = useMemo(() => buildPicksText(picksKey ? picksKey.split("\n") : []), [picksKey]);
  useEffect(() => () => disposeParts(picksParts), [picksParts]);
  const polaroid = useMemo(
    () => buildPolaroid(avatarInitial, displayName, avatarColor(displayName || avatarInitial)),
    [avatarInitial, displayName],
  );
  useEffect(() => () => disposeParts(polaroid), [polaroid]);

  const board = useRef<Group>(null);
  const apron = useRef<Group>(null);
  const photo = useRef<Group>(null);

  useFrame(() => {
    const m = motion.current;
    const t = m.now;
    const h = m.hint && !m.disabled ? hintEnvelope(t, 0.3) : 0;
    const press = pressBounce(t - m.pressedAt);
    if (board.current) {
      // hover: lifts a hair off the wall; hint: tiny "knock" wobble; press: boing
      board.current.position.z = WALL_Z + 0.012 * m.hoverK;
      board.current.rotation.z = ME_BOARD.tilt + 0.012 * h * Math.sin(t * 9) + 0.01 * press;
      const s = 1 + 0.015 * m.hoverK - 0.02 * press;
      board.current.scale.set(s, s, 1);
    }
    if (apron.current) {
      // the apron always breathes a little; it sways more on hover / hint / tap
      apron.current.rotation.z = 0.012 * Math.sin(t * 0.9) + 0.02 * m.hoverK * Math.sin(t * 3) + 0.035 * h * Math.sin(t * 5) + 0.05 * press;
    }
    if (photo.current) {
      photo.current.rotation.z = APRON_POLAROID.rotZ + 0.06 * h * Math.sin(t * 7) + 0.03 * m.hoverK * Math.sin(t * 4) + 0.08 * press;
    }
  });

  return (
    <group name="MeStation">
      <group ref={board} position={[ME_BOARD.x, ME_BOARD.y, WALL_Z]} rotation={[0, 0, ME_BOARD.tilt]}>
        <Parts parts={shared.board} />
        <Parts parts={picksParts} />
        <Glint position={[ME_BOARD.w / 2 - 0.05, ME_BOARD.h / 2 - 0.05, 0.05]} motion={motion} offset={0.3} />
      </group>
      <group ref={apron} position={[ME_HOOK.x, ME_HOOK.y, WALL_Z]}>
        <Parts parts={shared.apron} />
        <group ref={photo} position={APRON_POLAROID.pos} rotation={[0, 0, APRON_POLAROID.rotZ]}>
          {/* the card hangs from its clothespin: pivot at the card's top edge */}
          <group position={[0, -POLAROID.h / 2 + 0.012, 0]}>
            <Parts parts={polaroid} />
          </group>
          <group position={[0, 0.006, -0.002]}>
            <Parts parts={shared.clothespin} />
          </group>
          <Glint position={[POLAROID.w / 2 - 0.01, -0.02, 0.02]} size={0.035} motion={motion} offset={2.6} />
        </group>
      </group>
      <PropHitBoxes name="me" boxes={[HIT.meBoard, HIT.meApron]} handlers={handlers} disabled={disabled} />
    </group>
  );
}
