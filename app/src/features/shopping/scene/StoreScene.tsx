/* eslint-disable react/no-unknown-property -- R3F JSX props */
/* eslint-disable react-hooks/immutability -- three.js objects are mutated in useFrame by design */
/**
 * The 3D store: environment, one gondola run + hanging sign per aisle section, the list items on the shelves (pantry
 * FoodItem meshes) with shelf-edge price tags, hopping items, and the cart. Sections far outside the view are not
 * mounted (virtualised on the throttled scroll x).
 */
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

import { FoodItem } from "../../pantry/scene/food/FoodItem";
import type { StoreItem } from "../mapping";
import type { Flight } from "../useShoppingTrip";
import { AisleCamera, type CameraBus } from "./AisleCamera";
import { Gondola } from "./Gondola";
import { arcPoint, cameraDistance, halfWidthAt, HOP_MS, type AisleLayout, type AisleSectionLayout, type SlotPos } from "./layout";
import { CART_ITEM_SCALE, ShoppingCart, type CartBus } from "./ShoppingCart";
import { AisleSign, PriceTag } from "./Signage";
import { StoreEnvironment } from "./StoreEnvironment";
import { StoreLights } from "./StoreLights";
import type { AisleScroll } from "./useAisleScroll";

export type StoreSceneProps = {
  layout: AisleLayout;
  cart: StoreItem[];
  flights: Record<string, Flight>;
  scroll: AisleScroll;
  onItemPress: (item: StoreItem) => void;
  onCartItemPress: (item: StoreItem) => void;
};

export function StoreScene({ layout, cart, flights, scroll, onItemPress, onCartItemPress }: StoreSceneProps) {
  const camBus = useRef<CameraBus>({ x: 0, dist: 6, aspect: 0.5 });
  const cartBus = useRef<CartBus>({ drop: new THREE.Vector3(), landedAt: -10 });
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const hw = halfWidthAt(cameraDistance(aspect), aspect);
  const x = scroll.scrollX;
  const lo = x - hw - 1.5;
  const hi = x + hw + 1.5;
  const visible = layout.sections.filter((s) => s.x1 >= lo && s.x0 <= hi);

  const flying = useMemo(() => new Set(Object.keys(flights)), [flights]);
  const byId = useMemo(() => {
    const map = new Map<string, StoreItem>();
    for (const s of layout.sections) for (const it of s.items) map.set(it.row.id, it);
    return map;
  }, [layout]);

  return (
    <>
      <AisleCamera scroll={scroll} layout={layout} bus={camBus} />
      <StoreLights />
      <StoreEnvironment start={layout.start} end={layout.end} />
      {visible.map((s) => (
        <AisleSectionView key={s.aisle} section={s} flying={flying} onItemPress={onItemPress} />
      ))}
      {Object.values(flights).map((f) => {
        const it = byId.get(f.id);
        const slot = layout.slotById.get(f.id);
        if (!it || !slot) return null;
        return <FlyingItem key={`${f.id}-${f.startedAt}`} item={it} flight={f} slot={slot} cartBus={cartBus} />;
      })}
      <ShoppingCart items={cart} hidden={flying} camBus={camBus} cartBus={cartBus} onItemPress={onCartItemPress} />
    </>
  );
}

const AisleSectionView = memo(function AisleSectionView({
  section,
  flying,
  onItemPress,
}: {
  section: AisleSectionLayout;
  flying: ReadonlySet<string>;
  onItemPress: (item: StoreItem) => void;
}) {
  return (
    <group>
      <Gondola x0={section.x0} x1={section.x1} theme={section.theme} />
      <AisleSign x={(section.x0 + section.x1) / 2} label={section.label} />
      {section.items.map((it, i) => {
        const slot = section.slots[i];
        const onShelf = !it.row.checked && !flying.has(it.row.id);
        return (
          <group key={it.row.id}>
            <PriceTag
              x={slot.x}
              y={slot.y}
              name={it.pantry.name}
              quantity={it.row.quantityText}
              inCart={it.row.checked}
              badge={it.badge}
            />
            {onShelf ? (
              <FoodItem
                item={it.pantry}
                position={[slot.x, slot.y, slot.z]}
                glow={it.mine}
                dimmed={false}
                highlighted={false}
                onPress={() => onItemPress(it)}
                showTag={false}
              />
            ) : null}
          </group>
        );
      })}
    </group>
  );
});

const _from = { x: 0, y: 0, z: 0 };
const _to = { x: 0, y: 0, z: 0 };
const _p = { x: 0, y: 0, z: 0 };

/** An item hopping in an arc between its shelf slot and the cart (~0.6 s), spinning and shrinking to basket size. */
function FlyingItem({
  item,
  flight,
  slot,
  cartBus,
}: {
  item: StoreItem;
  flight: Flight;
  slot: SlotPos;
  cartBus: MutableRefObject<CartBus>;
}) {
  const ref = useRef<THREE.Group>(null);
  const landed = useRef(false);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const raw = (Date.now() - flight.startedAt) / HOP_MS;
    const t = Math.min(1, Math.max(0, raw));
    const drop = cartBus.current.drop;
    const inbound = flight.dir === "in";
    Object.assign(_from, inbound ? slot : drop);
    Object.assign(_to, inbound ? drop : slot);
    // ease-out on the horizontal travel so the landing feels soft
    const k = 1 - Math.pow(1 - t, 2);
    arcPoint(_from, _to, k, 0.7, _p);
    g.position.set(_p.x, _p.y, _p.z);
    const s = inbound ? 1 + (CART_ITEM_SCALE - 1) * k : CART_ITEM_SCALE + (1 - CART_ITEM_SCALE) * k;
    g.scale.setScalar(s);
    g.rotation.set(0, (inbound ? 1 : -1) * Math.PI * 2 * k, Math.sin(k * Math.PI) * 0.4);
    if (t >= 1 && inbound && !landed.current) {
      landed.current = true;
      cartBus.current.landedAt = clock.elapsedTime;
    }
  });
  return (
    <group ref={ref} position={[slot.x, slot.y, slot.z]}>
      <FoodItem item={item.pantry} position={[0, 0, 0]} glow={item.mine} dimmed={false} highlighted={false} onPress={noop} showTag={false} />
    </group>
  );
}

const noop = () => {};
