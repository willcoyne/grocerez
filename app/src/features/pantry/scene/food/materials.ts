/**
 * Materials for food items: per-item slot materials (colour, dim, emissive glow) plus shared tag materials,
 * and the additive radial-gradient halo shader (plain GLSL, works on expo-gl).
 */
import * as THREE from "three";
import type { FoodColors } from "./palette";
import type { FoodShape, Slot } from "./geometries";

export const ALLERGEN_RED = "#FF3B30";
export const HIGHLIGHT_GOLD = "#FFD24A";
export const LOW_ORANGE = "#FF9500";
/** Glow pulse period (seconds). */
export const GLOW_PERIOD = 2.5;
export const DIM_OPACITY = 0.25;

const SLOT_DEFAULT_COLOR: Record<Slot, string> = {
  primary: "#C68B59",
  secondary: "#8B5A2B",
  light: "#FBF6EC",
  dark: "#4A3222",
  wrap: "#FFFFFF",
};

export type SlotMaterials = Partial<Record<Slot, THREE.MeshStandardMaterial>>;

type BaseInfo = { color: THREE.Color; opacity: number; transparent: boolean };

export function createSlotMaterials(shape: FoodShape, colors: FoodColors): SlotMaterials {
  const out: SlotMaterials = {};
  for (const slot of Object.keys(shape.parts) as Slot[]) {
    const style = shape.styles[slot] ?? {};
    const color = style.color ?? (slot === "primary" ? colors.primary : slot === "secondary" ? colors.secondary : SLOT_DEFAULT_COLOR[slot]);
    const opacity = style.opacity ?? 1;
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: style.roughness ?? 0.6,
      metalness: style.metalness ?? 0,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
    });
    if (style.emissive) {
      m.emissive.set(style.emissive);
      m.emissiveIntensity = style.emissiveIntensity ?? 0.3;
    }
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

const RED = new THREE.Color(ALLERGEN_RED);
/** 0..1 pulse shared by every glowing item (synced on the clock). */
export function glowPulse(elapsed: number): number {
  return 0.5 + 0.5 * Math.sin((elapsed / GLOW_PERIOD) * Math.PI * 2);
}

export function applyGlow(mats: SlotMaterials, pulse: number | null) {
  for (const [slot, m] of Object.entries(mats) as [Slot, THREE.MeshStandardMaterial | undefined][]) {
    if (!m || slot === "wrap") continue;
    if (pulse === null) {
      const be = m.userData.baseEmissive as { color: THREE.Color; intensity: number };
      m.emissive.copy(be.color);
      m.emissiveIntensity = be.intensity;
    } else {
      m.emissive.copy(RED);
      m.emissiveIntensity = 0.18 + 0.5 * pulse;
    }
  }
}

export function disposeSlotMaterials(mats: SlotMaterials) {
  for (const m of Object.values(mats)) m?.dispose();
}

// ---------- shared tag materials (normal + dimmed variants) ----------

function pair(color: string, opts: THREE.MeshStandardMaterialParameters = {}) {
  const normal = new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });
  const dim = new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts, transparent: true, opacity: DIM_OPACITY, depthWrite: false });
  return { normal, dim };
}

let tagMats: ReturnType<typeof makeTagMats> | null = null;
function makeTagMats() {
  return {
    card: pair("#FFF8EE"),
    edge: pair("#C68B59"),
    text: pair("#3B2A1A"),
    low: pair(LOW_ORANGE, { emissive: new THREE.Color(LOW_ORANGE), emissiveIntensity: 0.35 }),
    warn: pair(ALLERGEN_RED, { emissive: new THREE.Color(ALLERGEN_RED), emissiveIntensity: 0.3 }),
    warnText: pair("#FFFFFF"),
  };
}
export function getTagMaterials() {
  if (!tagMats) tagMats = makeTagMats();
  return tagMats;
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

export function createHaloMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0.6 } },
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    transparent: true,
    depthWrite: false,
    // Normal alpha blending: additive washes out to white on the cream wall / white fridge.
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
}
