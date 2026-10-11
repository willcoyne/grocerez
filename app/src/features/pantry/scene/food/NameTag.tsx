/* eslint-disable react/no-unknown-property -- React Three Fiber props (position, geometry, material...) */
import { useMemo } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { useSceneTheme } from "../../../theme/ThemeProvider";
import { textScaleFor } from "../sceneTheme";
import { truncateLabel } from "./foodKind";
import { getTagMaterials } from "./materials";
import { getTextGeometry, textWidth } from "./text";

export const TAG_WIDTH = 0.3;
export const TAG_HEIGHT = 0.062;
const TAG_DEPTH = 0.012;
const TEXT_SIZE = 0.032;
const TEXT_DEPTH = 0.003;

let shared: { card: THREE.BufferGeometry; stand: THREE.BufferGeometry; dot: THREE.BufferGeometry; badge: THREE.BufferGeometry } | null = null;
function geo() {
  if (!shared) {
    shared = {
      card: new RoundedBoxGeometry(TAG_WIDTH, TAG_HEIGHT, TAG_DEPTH, 2, 0.005),
      stand: new RoundedBoxGeometry(0.12, 0.014, 0.04, 1, 0.004),
      dot: new THREE.CircleGeometry(0.012, 14),
      badge: new THREE.CircleGeometry(0.018, 16),
    };
  }
  return shared;
}

/**
 * A little place-card (theme paper + ink, theme font) standing in front of the item: name (truncated), optional "!"
 * badge in the theme's allergen colour for allergen items (a shape cue, not just colour) and an orange dot when low.
 */
export function NameTag({ name, low, warn, dimmed }: { name: string; low: boolean; warn: boolean; dimmed: boolean }) {
  const theme = useSceneTheme();
  const g = geo();
  const m = getTagMaterials(theme);
  const v = dimmed ? "dim" : "normal";
  const label = truncateLabel(name);
  const { textGeo, scale, x } = useMemo(() => {
    const tg = getTextGeometry(label, TEXT_SIZE * textScaleFor(theme, "tag"), TEXT_DEPTH, theme);
    const left = warn ? 0.04 : 0.012;
    const right = low ? 0.034 : 0.012;
    const maxW = TAG_WIDTH - left - right;
    const w = textWidth(tg);
    return { textGeo: tg, scale: w > maxW ? maxW / w : 1, x: (left - right) / 2 };
  }, [label, warn, low, theme]);
  const bangGeo = useMemo(() => (warn ? getTextGeometry("!", 0.026, 0.002, theme) : null), [warn, theme]);

  return (
    <group position={[0, 0.036, 0.19]} rotation={[-0.45, 0, 0]}>
      <mesh geometry={g.card} material={m.card[v]} />
      <mesh geometry={g.stand} material={m.edge[v]} position={[0, -TAG_HEIGHT / 2 - 0.004, -0.012]} />
      <mesh geometry={textGeo} material={m.text[v]} position={[x, 0, TAG_DEPTH / 2 + TEXT_DEPTH / 2 + 0.0005]} scale={[scale, scale, 1]} />
      {warn && bangGeo ? (
        <group position={[-TAG_WIDTH / 2 + 0.024, 0, TAG_DEPTH / 2 + 0.0008]}>
          <mesh geometry={g.badge} material={m.warn[v]} />
          <mesh geometry={bangGeo} material={m.warnText[v]} position={[0, 0.001, 0.0012]} />
        </group>
      ) : null}
      {low ? <mesh geometry={g.dot} material={m.low[v]} position={[TAG_WIDTH / 2 - 0.02, 0, TAG_DEPTH / 2 + 0.0008]} /> : null}
    </group>
  );
}
