/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, position...) */
// Meal-prep calendar (SPEC Round 3 addendum): hangs from a binder clip on the pantry's LEFT front stile, the mirror of
// the pinned list on the right. It stays left of the left door's hinge line, so the swinging door never clips it, and
// its tap target sits in front of the pantry's tap-to-open box (like the note's) without being larger than the note's.
// Same geometry / placement / behaviour in every theme; themes only recolour (paper, ink, accent, pin, metal roles).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Group } from "three";

import { Glint, hintEnvelope, Parts, pressBounce, PropHitBoxes, useRoomProp, type RoomPropProps } from "./interaction";
import { CALENDAR, HIT } from "./layout";
import { buildCalendarContent, getCalendarShared } from "./parts/calendar";
import { disposeParts } from "./parts/common";

export type MealPrepCalendarProps = RoomPropProps & {
  /** month name to print (localised by the caller), e.g. "October" */
  monthLabel: string;
  /** today's date: lays out the grid, circles the day, doodles this week */
  today: Date;
};

/** Pivot = the clip at the top of the sheet. */
const PIVOT_Y = CALENDAR.height / 2;

export function MealPrepCalendar({ onPress, hint = false, disabled = false, monthLabel, today }: MealPrepCalendarProps) {
  const shared = getCalendarShared();
  const { motion, handlers } = useRoomProp({ onPress, hint, disabled });
  const valid = today instanceof Date && !Number.isNaN(today.getTime());
  const dayKey = valid ? `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}` : "";
  const content = useMemo(() => {
    const [y, m, d] = dayKey ? dayKey.split("-").map(Number) : [];
    const date = dayKey ? new Date(y, m, d) : new Date();
    return buildCalendarContent(monthLabel, date);
  }, [monthLabel, dayKey]);
  useEffect(() => () => disposeParts(content), [content]);

  const sheet = useRef<Group>(null);
  useFrame(() => {
    const m = motion.current;
    const t = m.now;
    const h = m.hint && !m.disabled ? hintEnvelope(t, 0.9) : 0;
    const press = pressBounce(t - m.pressedAt);
    if (sheet.current) {
      // flutter about the clip like the note does; hover lifts the bottom a little off the stile
      sheet.current.rotation.z = 0.05 * h * Math.sin(t * 9) + 0.025 * m.hoverK * Math.sin(t * 5) + 0.04 * press;
      sheet.current.rotation.x = -0.08 * m.hoverK;
    }
  });

  return (
    <group name="MealPrepCalendar">
      <group position={[CALENDAR.x, CALENDAR.y + PIVOT_Y, CALENDAR.z]} rotation={[0, 0, CALENDAR.rotZ]}>
        <group ref={sheet}>
          <group position={[0, -PIVOT_Y, 0]}>
            <Parts parts={shared} />
            <Parts parts={content} />
            <Glint position={[CALENDAR.width / 2 - 0.01, CALENDAR.height / 2 - 0.02, 0.02]} size={0.035} motion={motion} offset={0.9} />
          </group>
        </group>
      </group>
      <PropHitBoxes name="mealprep" boxes={[HIT.calendar]} handlers={handlers} disabled={disabled} />
    </group>
  );
}
