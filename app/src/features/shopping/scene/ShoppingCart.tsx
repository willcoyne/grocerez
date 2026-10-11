/* eslint-disable react/no-unknown-property -- R3F JSX props */
/**
 * The shopper's cart: a chrome wire basket with a green handle that rides along in front of the camera (bottom-right
 * of the view). Checked items sit in the basket (tap one to put it back while Undo is still possible). It bounces when
 * an item lands. Its world position is published through `bus` so hopping items can aim at it.
 */
import { useFrame } from "@react-three/fiber";
import { memo, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { FoodItem } from "../../pantry/scene/food/FoodItem";
import type { StoreItem } from "../mapping";
import type { CameraBus } from "./AisleCamera";
import { bounce, CART_DEPTH, halfHeightAt, halfWidthAt } from "./layout";
import { getStoreGeometries, getStoreMaterials, noRaycast } from "./materials";

/** Basket inner size (local units). */
const BW = 0.42;
const BD = 0.3;
const BH = 0.2;
const ROD = 0.006;
export const CART_ITEM_SCALE = 0.42;
/** Whole cart scale and its rotated half-width on screen (for keeping it inside the right edge). */
const CART_BODY_SCALE = 0.72;
const CART_HALF_W = 0.3;
/** How many items are drawn in the basket (the HUD shows the real count). */
const MAX_SHOWN = 12;

export type CartBus = {
  /** world position of the basket's drop point (top centre) */
  drop: THREE.Vector3;
  /** clock time of the last landing (for the bounce) */
  landedAt: number;
};

let wireGeo: THREE.BufferGeometry | null = null;
function basketGeometry() {
  if (wireGeo) return wireGeo;
  const parts: THREE.BufferGeometry[] = [];
  const bar = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const b = new THREE.BoxGeometry(sx, sy, sz);
    b.translate(x, y, z);
    parts.push(b);
  };
  // vertical rods on the four sides
  for (let x = -BW / 2; x <= BW / 2 + 1e-6; x += 0.035) {
    bar(x, BH / 2, -BD / 2, ROD, BH, ROD);
    bar(x, BH / 2, BD / 2, ROD, BH, ROD);
  }
  for (let z = -BD / 2; z <= BD / 2 + 1e-6; z += 0.035) {
    bar(-BW / 2, BH / 2, z, ROD, BH, ROD);
    bar(BW / 2, BH / 2, z, ROD, BH, ROD);
  }
  // horizontal rails (3 levels) + rim
  for (const y of [0.002, BH * 0.5, BH]) {
    const t = y === BH ? ROD * 2.2 : ROD;
    bar(0, y, -BD / 2, BW + t, t, t);
    bar(0, y, BD / 2, BW + t, t, t);
    bar(-BW / 2, y, 0, t, t, BD + t);
    bar(BW / 2, y, 0, t, t, BD + t);
  }
  // floor grid
  for (let x = -BW / 2; x <= BW / 2 + 1e-6; x += 0.05) bar(x, 0, 0, ROD, ROD, BD);
  for (let z = -BD / 2; z <= BD / 2 + 1e-6; z += 0.05) bar(0, 0, z, BW, ROD, ROD);
  // handle posts going back/up towards the shopper
  bar(-BW / 2, BH + 0.05, BD / 2 + 0.05, ROD * 1.6, 0.1, ROD * 1.6);
  bar(BW / 2, BH + 0.05, BD / 2 + 0.05, ROD * 1.6, 0.1, ROD * 1.6);
  // chassis under the basket
  bar(-BW / 2 + 0.03, -0.2, 0, ROD * 2, 0.4, ROD * 2);
  bar(BW / 2 - 0.03, -0.2, 0, ROD * 2, 0.4, ROD * 2);
  wireGeo = mergeGeometries(parts) ?? new THREE.BoxGeometry(BW, BH, BD);
  parts.forEach((p) => p.dispose());
  return wireGeo;
}

/** Slot of the i-th item in the basket (local), 3 × 2 per layer. */
export function cartSlot(i: number): [number, number, number] {
  const layer = Math.floor(i / 6);
  const k = i % 6;
  const col = k % 3;
  const row = Math.floor(k / 3);
  return [(col - 1) * 0.13, 0.008 + layer * 0.12, (row - 0.5) * 0.12];
}

export const ShoppingCart = memo(function ShoppingCart({
  items,
  hidden,
  camBus,
  cartBus,
  onItemPress,
}: {
  items: StoreItem[];
  /** ids currently flying (drawn by the flight, not the basket) */
  hidden: ReadonlySet<string>;
  camBus: MutableRefObject<CameraBus>;
  cartBus: MutableRefObject<CartBus>;
  onItemPress: (item: StoreItem) => void;
}) {
  const g = getStoreGeometries();
  const m = getStoreMaterials();
  const rig = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const wire = useMemo(basketGeometry, []);
  const shown = useMemo(() => items.filter((it) => !hidden.has(it.row.id)).slice(-MAX_SHOWN), [items, hidden]);

  useFrame(({ camera, clock }) => {
    const r = rig.current;
    if (!r) return;
    // Ride with the camera: fixed spot in camera space, bottom-right.
    const { aspect } = camBus.current;
    const hw = halfWidthAt(CART_DEPTH, aspect);
    const hh = halfHeightAt(CART_DEPTH);
    const x = Math.min(hw - CART_HALF_W * CART_BODY_SCALE - 0.04, 1.1);
    r.position.copy(camera.position);
    r.quaternion.copy(camera.quaternion);
    r.updateMatrix();
    const b = body.current;
    if (b) {
      const s = clock.elapsedTime - cartBus.current.landedAt;
      const k = bounce(s);
      b.position.set(Math.max(0, x), -hh * 0.5 + k * 0.025, -CART_DEPTH);
      b.rotation.set(0.36, -0.42, k * 0.06);
      const sc = CART_BODY_SCALE;
      b.scale.set(sc * (1 + k * 0.04), sc * (1 - k * 0.05), sc * (1 + k * 0.04));
      b.updateMatrixWorld();
      cartBus.current.drop.set(0, BH + 0.04, 0);
      b.localToWorld(cartBus.current.drop);
    }
  });

  return (
    <group ref={rig}>
      <group ref={body}>
        <mesh geometry={wire} material={m.cartWire} castShadow={false} raycast={noRaycast} />
        {/* handle with green grip */}
        <mesh
          geometry={g.cylinder}
          material={m.cartHandle}
          position={[0, BH + 0.1, BD / 2 + 0.05]}
          rotation={[0, 0, Math.PI / 2]}
          scale={[0.016, BW + 0.04, 0.016]}
          raycast={noRaycast}
        />
        {/* wheels */}
        {[-1, 1].map((sx) =>
          [-1, 1].map((sz) => (
            <mesh
              key={`${sx}${sz}`}
              geometry={g.cylinder}
              material={m.cartWheel}
              position={[sx * (BW / 2 - 0.04), -0.42, sz * (BD / 2 - 0.03)]}
              rotation={[0, 0, Math.PI / 2]}
              scale={[0.04, 0.02, 0.04]}
              raycast={noRaycast}
            />
          )),
        )}
        {shown.map((it, i) => (
          <group key={it.row.id} position={cartSlot(i)} scale={CART_ITEM_SCALE} rotation={[0, ((i * 37) % 7) * 0.12 - 0.36, 0]}>
            <FoodItem item={it.pantry} position={[0, 0, 0]} glow={it.mine} dimmed={false} highlighted={false} onPress={() => onItemPress(it)} />
          </group>
        ))}
      </group>
    </group>
  );
});
