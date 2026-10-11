/* eslint-disable react/no-unknown-property -- R3F JSX props */
/**
 * Hanging aisle signs, the "GrocerEZ Market" logo and the yellow shelf-edge price tags. 3D text uses the pantry's
 * TextGeometry helper (bundled typeface; works on web and native). Font and materials follow the active theme.
 */
import { memo, useMemo } from "react";

import { useSceneTheme } from "../../theme/ThemeProvider";

import { getTextGeometry, textWidth } from "../../pantry/scene/food/text";
import { truncateLabel } from "../../pantry/scene/food/foodKind";
import { CEILING_Y, SIGN_Y } from "./layout";
import { getStoreGeometries, getStoreMaterials, noRaycast } from "./materials";

const SIGN_TEXT = 0.12;
const SIGN_H = 0.3;
const SIGN_Z = 0.4;

/** Two-cable hanging sign centred at x. */
export const AisleSign = memo(function AisleSign({ x, label }: { x: number; label: string }) {
  const theme = useSceneTheme();
  const g = getStoreGeometries();
  const m = getStoreMaterials(theme);
  const text = useMemo(() => getTextGeometry(label, SIGN_TEXT, 0.01, theme), [label, theme]);
  const w = Math.max(0.9, textWidth(text) + 0.36);
  const cableLen = CEILING_Y - (SIGN_Y + SIGN_H / 2);
  return (
    <group position={[x, SIGN_Y, SIGN_Z]}>
      <mesh geometry={g.roundBox} material={m.signRim} scale={[w + 0.04, SIGN_H + 0.04, 0.03]} castShadow raycast={noRaycast} />
      <mesh geometry={g.roundBox} material={m.sign} scale={[w, SIGN_H, 0.036]} raycast={noRaycast} />
      <mesh geometry={text} material={m.signText} position={[0, 0, 0.022]} raycast={noRaycast} />
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={g.cylinder}
          material={m.cable}
          position={[s * (w / 2 - 0.08), SIGN_H / 2 + cableLen / 2, 0]}
          scale={[0.006, cableLen, 0.006]}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
});

/** Store logo board over the entrance endcap. */
export const StoreLogo = memo(function StoreLogo({ x }: { x: number }) {
  const theme = useSceneTheme();
  const g = getStoreGeometries();
  const m = getStoreMaterials(theme);
  const big = useMemo(() => getTextGeometry("GrocerEZ", 0.2, 0.02, theme), [theme]);
  const small = useMemo(() => getTextGeometry("MARKET", 0.075, 0.01, theme), [theme]);
  const w = textWidth(big) + 0.5;
  return (
    <group position={[x, SIGN_Y + 0.05, SIGN_Z - 0.1]}>
      <mesh geometry={g.roundBox} material={m.signRim} scale={[w + 0.05, 0.56, 0.04]} castShadow raycast={noRaycast} />
      <mesh geometry={g.roundBox} material={m.logoBoard} scale={[w, 0.51, 0.05]} raycast={noRaycast} />
      <mesh geometry={big} material={m.logoText} position={[0, 0.07, 0.03]} raycast={noRaycast} />
      <mesh geometry={g.unitBox} material={m.logoRed} position={[0, -0.09, 0.03]} scale={[textWidth(small) + 0.16, 0.11, 0.01]} raycast={noRaycast} />
      <mesh geometry={small} material={m.logoText} position={[0, -0.09, 0.037]} raycast={noRaycast} />
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={g.cylinder}
          material={m.cable}
          position={[s * (w / 2 - 0.12), 0.28 + (CEILING_Y - SIGN_Y - 0.33) / 2, 0]}
          scale={[0.007, CEILING_Y - SIGN_Y - 0.33, 0.007]}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
});

export const TAG_W = 0.42;
const TAG_H = 0.1;
const NAME_SIZE = 0.036;
const QTY_SIZE = 0.028;
const BADGE_SIZE = 0.03;

/**
 * Shelf-edge tag clipped to the price rail under an item: name, quantity ("2 lb" or "1"), "IN CART" once checked, and
 * a red flag hanging below when the item is flagged for an allergen ("! Ann · peanuts"; text + "!" shape, not colour
 * alone).
 */
export const PriceTag = memo(function PriceTag({
  x,
  y,
  name,
  quantity,
  inCart,
  badge,
}: {
  x: number;
  /** shelf top surface */
  y: number;
  name: string;
  quantity: string | null;
  inCart: boolean;
  badge: string | null;
}) {
  const theme = useSceneTheme();
  const g = getStoreGeometries();
  const m = getStoreMaterials(theme);
  const nameGeo = useMemo(() => getTextGeometry(truncateLabel(name, 18), NAME_SIZE, 0.002, theme), [name, theme]);
  const subText = inCart ? "IN CART" : quantity ? truncateLabel(quantity, 14) : "1";
  const subGeo = useMemo(() => getTextGeometry(subText, QTY_SIZE, 0.002, theme), [subText, theme]);
  const badgeGeo = useMemo(() => (badge ? getTextGeometry(`! ${badge}`, BADGE_SIZE, 0.002, theme) : null), [badge, theme]);
  const maxW = TAG_W - 0.04;
  const nameW = textWidth(nameGeo);
  const nameScale = nameW > maxW ? maxW / nameW : 1;
  const subW = textWidth(subGeo);
  const badgeW = badgeGeo ? Math.min(TAG_W + 0.06, textWidth(badgeGeo) * Math.min(1, (TAG_W + 0.02) / textWidth(badgeGeo)) + 0.04) : 0;
  const badgeScale = badgeGeo ? Math.min(1, (TAG_W + 0.02) / textWidth(badgeGeo)) : 1;
  return (
    <group position={[x, y - 0.04, 0.014]}>
      <mesh geometry={g.unitBox} material={m.tag} scale={[TAG_W, TAG_H, 0.008]} raycast={noRaycast} />
      <mesh geometry={g.unitBox} material={m.tagRim} position={[0, TAG_H / 2 - 0.004, 0.001]} scale={[TAG_W, 0.008, 0.008]} raycast={noRaycast} />
      <mesh geometry={nameGeo} material={m.tagText} position={[0, 0.025, 0.006]} scale={[nameScale, 1, 1]} raycast={noRaycast} />
      <mesh
        geometry={subGeo}
        material={inCart ? m.tagDone : m.tagMuted}
        position={[-TAG_W / 2 + 0.02 + subW / 2, -0.03, 0.006]}
        raycast={noRaycast}
      />
      {badgeGeo ? (
        <group position={[0, -TAG_H / 2 - 0.028, 0.004]}>
          <mesh geometry={g.unitBox} material={m.badge} scale={[badgeW, 0.05, 0.006]} raycast={noRaycast} />
          <mesh geometry={badgeGeo} material={m.badgeText} position={[0, 0, 0.005]} scale={[badgeScale, 1, 1]} raycast={noRaycast} />
        </group>
      ) : null}
    </group>
  );
});
