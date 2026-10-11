/**
 * Materials for food items: per-item slot materials (colour, dim, emissive glow) plus shared tag materials,
 * and the halo shader (plain GLSL, works on expo-gl). Everything follows the active theme:
 * - slot materials are per-item, owned (createThemedMaterial), so dim / glow can mutate them in every shading style;
 * - the allergen glow animates per `theme.allergenGlow` (pulse / blink / steady outline) in the theme's allergen
 *   colour, and its halo becomes a marker-style ring for "outline" themes;
 * - tag materials are shared per theme.
 * Cozy reproduces the pre-theme look exactly.
 */
import * as THREE from "three";

import { createThemedMaterial, themedMaterial, type MaterialOverrides, type ThemedMaterial } from "../../../theme/materials";
import { getActiveTheme } from "../../../theme/store";
import type { SceneTheme } from "../../../theme/types";
import { hasGlow, sceneColors, washColor } from "../sceneTheme";
import type { FoodColors } from "./palette";
import type { FoodShape, Slot } from "./geometries";

/** Cozy allergen red (the active theme's colour is `allergenColor()`). */
export const ALLERGEN_RED = "#FF3B30";
/** Cozy highlight gold (the active theme's colour is `highlightColor()`). */
export const HIGHLIGHT_GOLD = "#FFD24A";
export const LOW_ORANGE = "#FF9500";
/** Cozy glow pulse period (seconds); themes set their own in `allergenGlow.periodS`. */
export const GLOW_PERIOD = 2.5;
export const DIM_OPACITY = 0.25;

export function allergenColor(theme: SceneTheme = getActiveTheme()): string {
  return theme.palette.allergen;
}

export function highlightColor(theme: SceneTheme = getActiveTheme()): string {
  return theme.palette.highlight;
}

const SLOT_DEFAULT_COLOR: Record<Slot, string> = {
  primary: "#C68B59",
  secondary: "#8B5A2B",
  light: "#FBF6EC",
  dark: "#4A3222",
  wrap: "#FFFFFF",
};

export type SlotMaterials = Partial<Record<Slot, ThemedMaterial>>;

type BaseInfo = { color: THREE.Color; opacity: number; transparent: boolean };

export function createSlotMaterials(shape: FoodShape, colors: FoodColors, theme: SceneTheme = getActiveTheme()): SlotMaterials {
  const out: SlotMaterials = {};
  for (const slot of Object.keys(shape.parts) as Slot[]) {
    const style = shape.styles[slot] ?? {};
    const color = style.color ?? (slot === "primary" ? colors.primary : slot === "secondary" ? colors.secondary : SLOT_DEFAULT_COLOR[slot]);
    const opacity = style.opacity ?? 1;
    const o: MaterialOverrides = {
      color: washColor(theme, color),
      roughness: style.roughness ?? 0.6,
      metalness: style.metalness ?? 0,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
      map: false,
    };
    if (style.emissive) {
      o.emissive = style.emissive;
      o.emissiveIntensity = style.emissiveIntensity ?? 0.3;
    } else {
      o.emissive = "#000000";
      o.emissiveIntensity = 1;
    }
    const m = createThemedMaterial(theme, "generic", o);
    m.userData.base = { color: m.color.clone(), opacity, transparent: m.transparent } satisfies BaseInfo;
    m.userData.baseEmissive = { color: m.emissive.clone(), intensity: m.emissiveIntensity };
    out[slot] = m;
  }
  return out;
}

const _grey = new THREE.Color();
/** Fade + desaturate (filtered out) or restore. */
export function applyDim(mats: SlotMaterials, dimmed: boolean) {
  for (const m of Object.values(mats)) {
    if (!m) continue;
    const base = m.userData.base as BaseInfo;
    if (dimmed) {
      const l = base.color.r * 0.299 + base.color.g * 0.587 + base.color.b * 0.114;
      _grey.setRGB(l, l, l);
      m.color.copy(base.color).lerp(_grey, 0.75);
      m.opacity = base.opacity * DIM_OPACITY;
      m.transparent = true;
      m.depthWrite = false;
    } else {
      m.color.copy(base.color);
      m.opacity = base.opacity;
      m.transparent = base.transparent;
      m.depthWrite = !base.transparent;
    }
    m.needsUpdate = true;
  }
}

/**
 * 0..1 glow level shared by every glowing item (synced on the clock), per the theme's allergen glow style:
 * "pulse" = smooth sine, "blink" = two-frame on/off (period ≥ 1 s: far below 3 flashes/s), "outline" = steady.
 */
export function glowPulse(elapsed: number, theme: SceneTheme = getActiveTheme()): number {
  const { style, periodS } = theme.allergenGlow;
  const period = theme.id === "cozy" ? GLOW_PERIOD : Math.max(1, periodS);
  if (style === "outline") return 1;
  if (style === "blink") return ((elapsed % period) + period) % period < period / 2 ? 1 : 0;
  return 0.5 + 0.5 * Math.sin((elapsed / period) * Math.PI * 2);
}

const _red = new THREE.Color();
export function applyGlow(mats: SlotMaterials, pulse: number | null, theme: SceneTheme = getActiveTheme()) {
  // themes with bloom-lit glow (neon) push the emissive harder so the halo blooms; the outline style stays a tint
  const amp = hasGlow(theme, "letters") ? 0.9 : theme.allergenGlow.style === "outline" ? 0.2 : 0.5;
  _red.set(theme.palette.allergen);
  for (const [slot, m] of Object.entries(mats) as [Slot, ThemedMaterial | undefined][]) {
    if (!m || slot === "wrap") continue;
    if (pulse === null) {
      const be = m.userData.baseEmissive as { color: THREE.Color; intensity: number };
      m.emissive.copy(be.color);
      m.emissiveIntensity = be.intensity;
    } else {
      m.emissive.copy(_red);
      m.emissiveIntensity = 0.18 + amp * pulse;
    }
  }
}

export function disposeSlotMaterials(mats: SlotMaterials) {
  for (const m of Object.values(mats)) m?.dispose();
}

// ---------- shared tag materials (normal + dimmed variants), per theme ----------

type TagPair = { normal: ThemedMaterial; dim: ThemedMaterial };

function makeTagMats(theme: SceneTheme) {
  const c = sceneColors(theme);
  const pair = (role: Parameters<typeof themedMaterial>[1], o: MaterialOverrides): TagPair => ({
    normal: themedMaterial(theme, role, { roughness: 0.7, map: false, hatch: false, ...o, tag: "tag" }),
    dim: themedMaterial(theme, role, { roughness: 0.7, map: false, hatch: false, ...o, opacity: DIM_OPACITY, transparent: true, depthWrite: false, tag: "tag" }),
  });
  return {
    card: pair("paper", { color: c.tagCard, side: "front" }),
    edge: pair("wood", { color: c.tagEdge }),
    text: pair("ink", { color: c.tagText }),
    low: pair("generic", { color: c.low, emissive: c.low, emissiveIntensity: 0.35 }),
    warn: pair("allergen", { color: theme.palette.allergen, emissive: theme.palette.allergen, emissiveIntensity: 0.3 }),
    warnText: pair("generic", { color: c.warnText }),
  };
}

const tagMats = new Map<string, ReturnType<typeof makeTagMats>>();
export function getTagMaterials(theme: SceneTheme = getActiveTheme()) {
  let m = tagMats.get(theme.id);
  if (!m) {
    m = makeTagMats(theme);
    tagMats.set(theme.id, m);
  }
  return m;
}

// ---------- halo shader ----------

const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = clamp(1.0 - d, 0.0, 1.0);
  a = a * a * (3.0 - 2.0 * a);
  a *= uIntensity;
  gl_FragColor = vec4(uColor, a);
}
`;

/** "outline" glow: a hand-drawn marker loop (two slightly offset, wobbly strokes) instead of a soft glow. */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
float stroke(float d, float r, float w) {
  return smoothstep(r - w, r - w * 0.4, d) * (1.0 - smoothstep(r + w * 0.4, r + w, d));
}
void main() {
  vec2 p = vUv - 0.5;
  float ang = atan(p.y, p.x);
  float d = length(p) * 2.0;
  float r1 = 0.8 + 0.035 * sin(ang * 3.0 + 0.6) + 0.015 * sin(ang * 11.0);
  float r2 = 0.84 + 0.03 * sin(ang * 4.0 + 2.1);
  float a = max(stroke(d, r1, 0.06), 0.75 * stroke(d, r2, 0.035));
  a *= clamp(uIntensity * 1.4, 0.0, 1.0);
  gl_FragColor = vec4(uColor, a);
}
`;

/**
 * Halo behind an item. `color` is the cozy constant (ALLERGEN_RED / HIGHLIGHT_GOLD) or any colour; the cozy
 * constants map to the active theme's allergen / highlight colour, and the allergen halo is drawn as a marker ring
 * in themes whose glow style is "outline".
 */
export function createHaloMaterial(color: string, theme: SceneTheme = getActiveTheme()): THREE.ShaderMaterial {
  const allergen = color === ALLERGEN_RED;
  const resolved = allergen ? allergenColor(theme) : color === HIGHLIGHT_GOLD ? highlightColor(theme) : color;
  const ring = allergen && theme.allergenGlow.style === "outline";
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(resolved) }, uIntensity: { value: 0.6 } },
    vertexShader: HALO_VERT,
    fragmentShader: ring ? RING_FRAG : HALO_FRAG,
    transparent: true,
    depthWrite: false,
    // Normal alpha blending: additive washes out to white on the cream wall / white fridge.
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
}
