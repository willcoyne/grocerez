/* eslint-disable react/no-unknown-property -- React Three Fiber props (position, geometry, material...) */
/**
 * The back of a flipped item: a nutrition panel printed on the package (packaged food) or an oval PLU sticker (fresh
 * produce). Size and placement come from `backPanel.ts` (the item's real back face), content/layout from the pure
 * `backLabelLayout.ts`. Every part (panel, rules, badges, merged flat text: one mesh per colour) is built flat in the
 * label plane, then each vertex is pushed along z onto the package surface (`depthAt`), so the label hugs boxes, cans,
 * bags and fruit like print, and reads exactly as laid out from the zoomed, head-on camera.
 * Built lazily (FoodItem mounts this on first flip) and cached by theme + content + placement. Card, ink and accent
 * colours and the font follow the active theme (sceneColors / theme font); printed layers stay flat (unlit) for legibility.
 *
 * Local frame: the label group sits at the item's (cx, cy) and is turned half a turn so its front faces local -z (the
 * item's back); FoodItem's flip then turns it toward the viewer.
 */
import type { Allergen } from "@contracts/dietary";
import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { themedMaterial, type ThemedMaterial } from "../../../theme/materials";
import { useSceneTheme } from "../../../theme/ThemeProvider";
import type { SceneTheme } from "../../../theme/types";
import type { FoodKind, PantryItem } from "../../types";
import { sceneColors } from "../sceneTheme";
import { backLabelContent, layoutBackLabel, NUTRI_COLORS, type BackLayout, type Rule, type Tone } from "./backLabelLayout";
import { depthAt, LABEL_GAP, type BackPanel } from "./backPanel";
import { buildFlatTextGeometry } from "./text";

/** Layers above the package surface (on top of LABEL_GAP). */
const LAYER = { ring: 0, base: 0.00025, rule: 0.0005, badge: 0.0005, badgeText: 0.0008, text: 0.0007 } as const;

/** Printed colours per tone for a theme (cozy: the original label colours). */
function toneColors(theme: SceneTheme): Record<Tone, string> {
  const c = sceneColors(theme);
  return {
    ink: c.labelInk,
    muted: c.labelMuted,
    red: c.labelRed,
    header: c.labelHeader,
    green: c.labelGreen,
    // Nutri-Score badge letters: fixed, they sit on the official badge colours
    light: "#FFFFFF",
    dark: "#1E140B",
  };
}

type Shared = {
  text: Record<Tone, THREE.MeshBasicMaterial>;
  card: ThemedMaterial;
  sticker: ThemedMaterial;
  stickerRing: ThemedMaterial;
  rule: THREE.MeshBasicMaterial;
  badge: Record<string, THREE.MeshBasicMaterial>;
};

const shared = new Map<string, Shared>();
function assets(theme: SceneTheme): Shared {
  const hit = shared.get(theme.id);
  if (hit) return hit;
  const tones = toneColors(theme);
  const c = sceneColors(theme);
  // polygonOffset pulls the thin printed layers forward a touch more at a distance (no shimmer when zooming out)
  const flat = (color: string) => new THREE.MeshBasicMaterial({ color, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  const text = Object.fromEntries((Object.keys(tones) as Tone[]).map((t) => [t, flat(tones[t])])) as Record<Tone, THREE.MeshBasicMaterial>;
  const badge = Object.fromEntries(Object.values(NUTRI_COLORS).map((col) => [col, flat(col)]));
  const s: Shared = {
    text,
    card: themedMaterial(theme, "paper", {
      color: c.labelCard,
      roughness: 0.85,
      emissive: c.labelCard,
      emissiveIntensity: 0.5,
      side: "double",
      map: false,
      hatch: false,
      tag: "label",
    }),
    sticker: themedMaterial(theme, "generic", { color: c.sticker, roughness: 0.6, emissive: c.sticker, emissiveIntensity: 0.45, side: "double", hatch: false, tag: "label" }),
    stickerRing: themedMaterial(theme, "generic", { color: c.stickerRing, roughness: 0.6, side: "double", hatch: false, tag: "label" }),
    rule: flat(tones.header),
    badge,
  };
  shared.set(theme.id, s);
  return s;
}

type Built = {
  layout: BackLayout;
  base: THREE.BufferGeometry;
  ring: THREE.BufferGeometry | null;
  rules: THREE.BufferGeometry | null;
  badges: [string, THREE.BufferGeometry][];
  text: [Tone, THREE.BufferGeometry][];
};

/** Built labels by content + placement key (LRU). Evicted geometries are disposed; three re-uploads if still mounted. */
const CACHE = new Map<string, Built>();
const CACHE_MAX = 24;

/** Push every vertex of a label-plane geometry onto the package surface (+ `layer`). Mutates and returns `g`. */
function wrapOnto(g: THREE.BufferGeometry, panel: BackPanel, layer: number): THREE.BufferGeometry {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const v = pos.getY(i);
    // label plane (u, v) -> item local (cx - u, cy + v): the group is turned half a turn about Y
    pos.setZ(i, depthAt(panel.surface, panel.cx - u, panel.cy + v) + LABEL_GAP + layer);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Grid density so curved surfaces stay smooth (~3 mm cells, capped). */
const cells = (len: number, max = 40) => Math.max(2, Math.min(max, Math.ceil(len / 0.003)));

/** Subdivided rectangle, card space (top-left origin, y down) -> label plane (centred, y up). */
function rectGeo(r: Rule, W: number, H: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(r.w, r.h, cells(r.w, 32), cells(r.h, 8));
  g.translate(r.x + r.w / 2 - W / 2, H / 2 - (r.y + r.h / 2), 0);
  return g;
}

/** Filled ellipse w x h with an even grid (square -> disc map), so it can bend over a sphere without poking through. */
function ovalGeo(w: number, h: number, n = 16): THREE.BufferGeometry {
  const verts: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * 2 - 1;
      const b = (j / n) * 2 - 1;
      verts.push(a * Math.sqrt(1 - (b * b) / 2) * (w / 2), b * Math.sqrt(1 - (a * a) / 2) * (h / 2), 0);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * (n + 1) + i;
      idx.push(k, k + 1, k + n + 2, k, k + n + 2, k + n + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

/** Ring between ellipses (w, h) and (w + 2t, h + 2t). */
function ovalRingGeo(w: number, h: number, t: number, seg = 48): THREE.BufferGeometry {
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const th = (i / seg) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    verts.push((c * w) / 2, (s * h) / 2, 0, c * (w / 2 + t), s * (h / 2 + t), 0);
  }
  for (let i = 0; i < seg; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 3, k, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const m = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return m;
}

function build(layout: BackLayout, panel: BackPanel, key: string, theme: SceneTheme): Built {
  const hit = CACHE.get(key);
  if (hit) {
    CACHE.delete(key);
    CACHE.set(key, hit);
    return hit;
  }
  const { width: W, height: H } = layout;
  const produce = layout.style === "produce";
  const ringT = Math.min(W, H) * 0.05;
  const base = wrapOnto(produce ? ovalGeo(W, H) : rectGeo({ x: 0, y: 0, w: W, h: H }, W, H), panel, LAYER.base);
  const ring = produce ? wrapOnto(ovalRingGeo(W, H, ringT), panel, LAYER.ring) : null;
  const rulesG = mergeAll(layout.rules.map((r) => rectGeo(r, W, H)));
  const rules = rulesG ? wrapOnto(rulesG, panel, LAYER.rule) : null;
  const byColor = new Map<string, THREE.BufferGeometry[]>();
  for (const b of layout.badges) {
    const list = byColor.get(b.color) ?? [];
    list.push(rectGeo(b, W, H));
    byColor.set(b.color, list);
  }
  const badges: [string, THREE.BufferGeometry][] = [];
  for (const [color, list] of byColor) {
    const g = mergeAll(list);
    if (g) badges.push([color, wrapOnto(g, panel, LAYER.badge)]);
  }
  const byTone = new Map<Tone, { text: string; x: number; y: number; size: number }[]>();
  for (const r of layout.runs) {
    // card space (top-left origin, y down) -> label plane (centred, y up)
    const run = { text: r.text, size: r.size, x: r.x - W / 2, y: H / 2 - r.y };
    const list = byTone.get(r.tone);
    if (list) list.push(run);
    else byTone.set(r.tone, [run]);
  }
  const text: [Tone, THREE.BufferGeometry][] = [];
  for (const [tone, runs] of byTone) {
    const g = buildFlatTextGeometry(runs, 2, theme);
    // badge letters sit above the badge
    if (g) text.push([tone, wrapOnto(g, panel, tone === "light" || tone === "dark" ? LAYER.badgeText : LAYER.text)]);
  }
  const built: Built = { layout, base, ring, rules, badges, text };
  CACHE.set(key, built);
  while (CACHE.size > CACHE_MAX) {
    const [oldKey, old] = CACHE.entries().next().value as [string, Built];
    CACHE.delete(oldKey);
    old.base.dispose();
    old.ring?.dispose();
    old.rules?.dispose();
    for (const [, g] of old.badges) g.dispose();
    for (const [, g] of old.text) g.dispose();
  }
  return built;
}

export type BackLabelProps = { item: PantryItem; kind: FoodKind; panel: BackPanel; myAllergens: readonly Allergen[] };

export function useBackLayout(item: PantryItem, kind: FoodKind, panel: BackPanel, myAllergens: readonly Allergen[]) {
  const content = useMemo(() => backLabelContent(item, kind, myAllergens), [item, kind, myAllergens]);
  const key = useMemo(() => JSON.stringify([content, panel]), [content, panel]);
  const layout = useMemo(() => layoutBackLabel(content, panel), [content, panel]);
  return { layout, key };
}

export function BackLabel({ item, kind, panel, myAllergens }: BackLabelProps) {
  const theme = useSceneTheme();
  const { layout, key } = useBackLayout(item, kind, panel, myAllergens);
  // geometry depends on the theme font: the cache key includes the theme
  const built = useMemo(() => build(layout, panel, `${theme.id}|${key}`, theme), [layout, panel, key, theme]);
  const A = assets(theme);
  const produce = built.layout.style === "produce";

  return (
    // faces the item's back: half a turn so the label's front points down local -z
    <group rotation={[0, Math.PI, 0]} position={[panel.cx, panel.cy, 0]}>
      {built.ring ? <mesh geometry={built.ring} material={A.stickerRing} /> : null}
      <mesh geometry={built.base} material={produce ? A.sticker : A.card} />
      {built.rules ? <mesh geometry={built.rules} material={A.rule} /> : null}
      {built.badges.map(([color, g]) => (
        <mesh key={color} geometry={g} material={A.badge[color] ?? A.rule} />
      ))}
      {built.text.map(([tone, g]) => (
        <mesh key={tone} geometry={g} material={A.text[tone]} />
      ))}
    </group>
  );
}
