/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, position...) */
// Household station (SPEC Round 3, RIGHT wall above the stool ≈ (2.45, 2.35)): framed cork board with up to 5 member
// polaroids (initial + name), postcards for pending invites, an alert slip held by red pushpins with a red count
// badge (a number + "!" — never colour alone), and a recipe index card.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Group } from "three";

import { Glint, hintEnvelope, Parts, pressBounce, PropHitBoxes, useRoomProp, type RoomPropProps } from "./interaction";
import { CORK_BOARD, HIT, WALL_Z } from "./layout";
import { disposeParts } from "./parts/common";
import { BADGE, buildBadge, buildHouseholdContent, getHouseholdFrame, MAX_MEMBERS, type Member } from "./parts/household";

export type HouseholdStationProps = RoomPropProps & {
  /** first 5 are pinned up as polaroids */
  members: Member[];
  /** pending invites → postcards (up to 3 drawn, the top one says how many) */
  inviteCount: number;
  /** expiring / recall alerts → red pins + count badge (0 = none) */
  alertCount: number;
};

export function HouseholdStation({ onPress, hint = false, disabled = false, members, inviteCount, alertCount }: HouseholdStationProps) {
  const frame = getHouseholdFrame();
  const { motion, handlers } = useRoomProp({ onPress, hint, disabled });
  const membersKey = members
    .slice(0, MAX_MEMBERS)
    .map((m) => `${m.initial}\u0001${m.name}`)
    .join("\u0002");
  const content = useMemo(() => {
    const list: Member[] = membersKey
      ? membersKey.split("\u0002").map((s) => {
          const [initial, name] = s.split("\u0001");
          return { initial, name };
        })
      : [];
    return buildHouseholdContent(list, inviteCount, alertCount);
  }, [membersKey, inviteCount, alertCount]);
  useEffect(() => () => disposeParts(content), [content]);
  const alerts = Math.max(0, Math.floor(alertCount));
  const badge = useMemo(() => (alerts > 0 ? buildBadge(alerts) : null), [alerts]);
  useEffect(() => () => (badge ? disposeParts(badge) : undefined), [badge]);

  const board = useRef<Group>(null);
  const badgeRef = useRef<Group>(null);
  useFrame(() => {
    const m = motion.current;
    const t = m.now;
    const h = m.hint && !m.disabled ? hintEnvelope(t, 1.7) : 0;
    const press = pressBounce(t - m.pressedAt);
    if (board.current) {
      board.current.position.z = WALL_Z + 0.01 * m.hoverK;
      const s = 1 + 0.012 * m.hoverK - 0.015 * press;
      board.current.scale.set(s, s, 1);
    }
    if (badgeRef.current) {
      // the badge gives a little pop on the hint beat (alerts deserve attention)
      const s = 1 + 0.18 * h + 0.06 * m.hoverK;
      badgeRef.current.scale.set(s, s, s);
      badgeRef.current.rotation.z = 0.15 * h * Math.sin(t * 10);
    }
  });

  return (
    <group name="HouseholdStation">
      <group ref={board} position={[CORK_BOARD.x, CORK_BOARD.y, WALL_Z]}>
        <Parts parts={frame} />
        <Parts parts={content} />
        {badge ? (
          <group ref={badgeRef} position={[BADGE.x, BADGE.y, BADGE.z]}>
            <Parts parts={badge} />
          </group>
        ) : null}
        <Glint position={[-CORK_BOARD.w / 2 + 0.06, CORK_BOARD.h / 2 - 0.05, 0.07]} motion={motion} offset={1.7} />
      </group>
      <PropHitBoxes name="household" boxes={[HIT.household]} handlers={handlers} disabled={disabled} />
    </group>
  );
}
