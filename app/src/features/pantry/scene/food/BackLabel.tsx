/* eslint-disable react/no-unknown-property -- React Three Fiber props (position, geometry, material...) */
/**
 * The back of a flipped item: a cream nutrition-panel card (packaged food) or a round PLU sticker (fresh produce).
 * Content/layout come from the pure `backLabelLayout.ts`; here they become a few merged flat-text meshes (one per colour),
 * a card, rules and the Nutri-Score badge. Built lazily (FoodItem mounts this on first flip) and cached by content.
 *
 * Local frame: the label faces local -z (the item's back), card bottom near y = 0. FoodItem places it behind the mesh.
 */
import type { Allergen } from "@contracts/dietary";
import { useMemo } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { FoodKind, PantryItem } from "../../types";
import { ALLERGEN_RED } from "./materials";
import { backLabelContent, layoutBackLabel, NUTRI_COLORS, type BackLayout, type Tone } from "./backLabelLayout";
import { buildFlatTextGeometry } from "./text";

const CARD_T = 0.008;
const TEXT_Z = CARD_T / 2 + 0.0008;

const TONE_COLORS: Record<Tone, string> = {
  ink: "#3B2A1A",
  muted: "#7A6652",
  red: ALLERGEN_RED,
  header: "#1E140B",
  green: "#2E7D32",
  light: "#FFFFFF",
  dark: "#1E140B",
};

type Shared = {
  text: Record<Tone, THREE.MeshBasicMaterial>;
  card: THREE.MeshStandardMaterial;
  cardEdge: THREE.MeshStandardMaterial;
  sticker: THREE.MeshStandardMaterial;
  stickerRing: THREE.MeshStandardMaterial;
  rule: THREE.MeshBasicMaterial;
  badge: Record<string, THREE.MeshBasicMaterial>;
  panelGeo: THREE.BufferGeometry;
  panelEdgeGeo: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  unit: THREE.BufferGeometry;
};

let shared: Shared | null = null;
function assets(): Shared {
  if (shared) return shared;
  const text = Object.fromEntries(
    (Object.keys(TONE_COLORS) as Tone[]).map((t) => [t, new THREE.MeshBasicMaterial({ color: TONE_COLORS[t], toneMapped: false })]),
  ) as Record<Tone, THREE.MeshBasicMaterial>;
  const badge = Object.fromEntries(
    Object.values(NUTRI_COLORS).map((c) => [c, new THREE.MeshBasicMaterial({ color: c, toneMapped: false })]),
  );
  shared = {
    text,
    card: new THREE.MeshStandardMaterial({ color: "#FFF8EE", roughness: 0.85, emissive: new THREE.Color("#FFF8EE"), emissiveIntensity: 0.18 }),
    cardEdge: new THREE.MeshStandardMaterial({ color: "#D9C3A0", roughness: 0.9 }),
    sticker: new THREE.MeshStandardMaterial({ color: "#FFFFFF", roughness: 0.6, emissive: new THREE.Color("#FFFFFF"), emissiveIntensity: 0.15 }),
    stickerRing: new THREE.MeshStandardMaterial({ color: "#2E7D32", roughness: 0.6 }),
    rule: new THREE.MeshBasicMaterial({ color: TONE_COLORS.header, toneMapped: false }),
    badge,
    panelGeo: new RoundedBoxGeometry(1, 1, CARD_T, 2, 0.003),
    panelEdgeGeo: new RoundedBoxGeometry(1, 1, CARD_T * 0.6, 2, 0.003),
    disc: new THREE.CircleGeometry(0.5, 48),
    unit: new THREE.PlaneGeometry(1, 1),
  };
  return shared;
}

type Built = { layout: BackLayout; text: [Tone, THREE.BufferGeometry][] };

/** Built labels by content key (LRU). Evicted geometries are disposed; three re-uploads if one is still mounted. */
const CACHE = new Map<string, Built>();
const CACHE_MAX = 24;

function build(layout: BackLayout, key: string): Built {
  const hit = CACHE.get(key);
  if (hit) {
    CACHE.delete(key);
    CACHE.set(key, hit);
    return hit;
  }
  const byTone = new Map<Tone, { text: string; x: number; y: number; size: number }[]>();
  for (const r of layout.runs) {
    // card space (top-left origin, y down) → label plane (centred, y up)
    const run = { text: r.text, size: r.size, x: r.x - layout.width / 2, y: layout.height / 2 - r.y };
    const list = byTone.get(r.tone);
    if (list) list.push(run);
    else byTone.set(r.tone, [run]);
  }
  const text: [Tone, THREE.BufferGeometry][] = [];
  for (const [tone, runs] of byTone) {
    const g = buildFlatTextGeometry(runs);
    if (g) text.push([tone, g]);
  }
  const built = { layout, text };
  CACHE.set(key, built);
  while (CACHE.size > CACHE_MAX) {
    const [oldKey, old] = CACHE.entries().next().value as [string, Built];
    CACHE.delete(oldKey);
    for (const [, g] of old.text) g.dispose();
  }
  return built;
}

export type BackLabelProps = { item: PantryItem; kind: FoodKind; myAllergens: readonly Allergen[] };

export function useBackLayout(item: PantryItem, kind: FoodKind, myAllergens: readonly Allergen[]) {
  const content = useMemo(() => backLabelContent(item, kind, myAllergens), [item, kind, myAllergens]);
  const key = useMemo(() => JSON.stringify(content), [content]);
  const layout = useMemo(() => layoutBackLabel(content), [content]);
  return { layout, key };
}

export function BackLabel({ item, kind, myAllergens }: BackLabelProps) {
  const { layout, key } = useBackLayout(item, kind, myAllergens);
  const built = useMemo(() => build(layout, key), [layout, key]);
  const A = assets();
  const { width: W, height: H } = built.layout;
  const plane = (x: number, y: number, w: number, h: number): [number, number, number] => [x + w / 2 - W / 2, H / 2 - (y + h / 2), TEXT_Z - 0.0003];

  return (
    // faces the item's back: rotate the label plane half a turn so its front points down local -z
    <group rotation={[0, Math.PI, 0]} position={[0, H / 2, 0]}>
      {built.layout.style === "panel" ? (
        <>
          <mesh geometry={A.panelEdgeGeo} material={A.cardEdge} scale={[W + 0.012, H + 0.012, 1]} position={[0, 0, -CARD_T * 0.4]} />
          <mesh geometry={A.panelGeo} material={A.card} scale={[W, H, 1]} castShadow />
        </>
      ) : (
        <>
          <mesh geometry={A.disc} material={A.stickerRing} scale={[W + 0.018, H + 0.018, 1]} position={[0, 0, -0.001]} />
          <mesh geometry={A.disc} material={A.sticker} scale={[W, H, 1]} />
        </>
      )}
      {built.layout.rules.map((r, i) => (
        <mesh key={`r${i}`} geometry={A.unit} material={A.rule} position={plane(r.x, r.y, r.w, r.h)} scale={[r.w, r.h, 1]} />
      ))}
      {built.layout.badges.map((b, i) => (
        <mesh
          key={`b${i}`}
          geometry={A.unit}
          material={A.badge[b.color] ?? A.rule}
          position={plane(b.x, b.y, b.w, b.h)}
          scale={[b.w, b.h, 1]}
        />
      ))}
      {built.text.map(([tone, g]) => (
        <mesh key={tone} geometry={g} material={A.text[tone]} position={[0, 0, TEXT_Z]} />
      ))}
    </group>
  );
}
