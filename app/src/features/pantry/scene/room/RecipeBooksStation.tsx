/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, material, position...) */
// Recipes station (SPEC Round 3 addendum, LEFT wall ≈ (-1.75, 2.55), above the light switch): a small wooden wall
// shelf with a stack of recipe books (one askew, an index card peeking out, ribbon bookmarks) and one leaning book.
// Same geometry / placement / behaviour in every theme; themes only recolour through roomMaterials roles
// (wood, woodDark, bookCloth, bookPage, paper, cloth, metal, ink).
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

import { Glint, hintEnvelope, Parts, pressBounce, PropHitBoxes, useRoomProp, type RoomPropProps } from "./interaction";
import { BOOK_SHELF, HIT, WALL_Z } from "./layout";
import { getBooksShared } from "./parts/books";

export type RecipeBooksStationProps = RoomPropProps;

export function RecipeBooksStation({ onPress, hint = false, disabled = false }: RecipeBooksStationProps) {
  const parts = getBooksShared();
  const { motion, handlers } = useRoomProp({ onPress, hint, disabled });
  const books = useRef<Group>(null);

  useFrame(() => {
    const m = motion.current;
    const t = m.now;
    const h = m.hint && !m.disabled ? hintEnvelope(t, 4.0) : 0;
    const press = pressBounce(t - m.pressedAt);
    if (books.current) {
      books.current.position.y = BOOK_SHELF.y + 0.008 * h * Math.abs(Math.sin(t * 8)) + 0.004 * m.hoverK;
      books.current.position.z = WALL_Z + 0.01 * m.hoverK;
      const s = 1 + 0.02 * m.hoverK - 0.025 * press;
      books.current.scale.set(s, s, s);
    }
  });

  return (
    <group name="RecipeBooksStation">
      <group ref={books} position={[BOOK_SHELF.x, BOOK_SHELF.y, WALL_Z]}>
        <Parts parts={parts} />
        <Glint position={[-0.2, 0.17, BOOK_SHELF.depth - 0.02]} size={0.04} motion={motion} offset={4.0} />
      </group>
      <PropHitBoxes name="recipes" boxes={[HIT.books]} handlers={handlers} disabled={disabled} />
    </group>
  );
}
