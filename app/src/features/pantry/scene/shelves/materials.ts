/**
 * Shared, module-level geometries / materials / procedural textures for the shelf column.
 * Everything is created lazily once and reused by every row (no per-render allocations).
 * Textures are procedural DataTextures (no image assets, no canvas) so they work on native via expo-gl.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { DEPTH, INNER_WIDTH, LIP_HEIGHT, UPRIGHT_THICKNESS } from "./layout";

export const COLORS = {
  wood: "#C68B59",
  darkWood: "#8B5A2B",
  backWood: "#B57B4B",
  labelPaint: "#4A2A12",
  steel: "#C9CED3",
  steelDark: "#8E969E",
  fridgeWall: "#F4F7FA",
  glass: "#BFE6FF",
  glassEdge: "#E9FBFF",
  led: "#F2FAFF",
  freezerWall: "#CFEFFF",
  frostLabel: "#1F5D8C",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// tiny deterministic noise (procedural textures must look the same on every launch)

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise2D(w: number, h: number, cell: number, rand: () => number) {
  const gw = Math.ceil(w / cell) + 1;
  const gh = Math.ceil(h / cell) + 1;
  const grid = new Float32Array(gw * gh).map(() => rand());
  return (x: number, y: number) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx) % (gw - 1);
    const y0 = Math.floor(gy) % (gh - 1);
    const fx = gx - Math.floor(gx);
    const fy = gy - Math.floor(gy);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (ix: number, iy: number) => grid[iy * gw + ix];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function makeTexture(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number], srgb = true) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Light greyscale wood grain running along x (multiplied with the material colour). */
function woodGrainTexture() {
  const rand = mulberry32(7);
  const w = 256;
  const h = 64;
  const n = valueNoise2D(w, h, 16, rand);
  const fine = valueNoise2D(w, h, 3, rand);
  return makeTexture(w, h, (x, y) => {
    const warp = n(x, y) * 6;
    const rings = Math.sin((y + warp) * 0.9) * 0.5 + 0.5;
    const v = 205 + rings * 30 + (fine(x, y) - 0.5) * 22 + (n(x * 0.5, y * 2) - 0.5) * 20;
    const c = clamp255(v);
    return [c, clamp255(c * 0.97), clamp255(c * 0.93), 255];
  });
}

/** Beadboard back panel: vertical planks with dark seams and grain along y. One tile = 4 planks across. */
function beadboardTexture() {
  const rand = mulberry32(21);
  const w = 128;
  const h = 256;
  const n = valueNoise2D(w, h, 14, rand);
  const fine = valueNoise2D(w, h, 2, rand);
  const plankW = w / 4;
  const tones = [0, 1, 2, 3].map(() => 0.9 + rand() * 0.12);
  return makeTexture(w, h, (x, y) => {
    const p = Math.floor(x / plankW);
    const local = x % plankW;
    const warp = n(x, y) * 5;
    const grain = Math.sin((x + warp) * 1.4) * 0.5 + 0.5;
    let v = (208 + grain * 16 + (fine(x, y) - 0.5) * 14) * tones[p];
    if (local < 1.5) v *= 0.55; // seam
    else if (local < 3) v *= 0.82; // bevel shadow
    else if (local > plankW - 2) v *= 1.07; // bevel highlight
    const c = clamp255(v);
    return [c, clamp255(c * 0.97), clamp255(c * 0.92), 255];
  });
}

/** Frost: mottled white/ice noise with crystal speckles. */
function frostTexture() {
  const rand = mulberry32(99);
  const w = 128;
  const h = 128;
  const big = valueNoise2D(w, h, 24, rand);
  const mid = valueNoise2D(w, h, 8, rand);
  return makeTexture(w, h, (x, y) => {
    const v = big(x, y) * 0.55 + mid(x, y) * 0.35 + rand() * 0.1;
    const speck = rand() > 0.985 ? 40 : 0;
    const r = clamp255(200 + v * 55 + speck);
    const g = clamp255(225 + v * 30 + speck);
    return [r, g, 255, 255];
  });
}

/** Soft round sprite (white, alpha falloff) for sparkles and mist. */
function softDotTexture(size: number, hardness: number) {
  return makeTexture(
    size,
    size,
    (x, y) => {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.pow(1 - d, hardness);
      return [255, 255, 255, clamp255(a * 255)];
    },
    false,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// lazy singletons

let cache: ReturnType<typeof build> | null = null;

function build() {
  const grain = woodGrainTexture();
  const beadboard = beadboardTexture();
  const frost = frostTexture();
  const sparkle = softDotTexture(32, 2.2);
  const mist = softDotTexture(64, 1.6);

  const boardGeo = new RoundedBoxGeometry(INNER_WIDTH, 0.045, DEPTH - 0.03, 2, 0.012);
  const lipGeo = new RoundedBoxGeometry(INNER_WIDTH + 0.01, LIP_HEIGHT, 0.04, 2, 0.014);
  const glassGeo = new THREE.BoxGeometry(INNER_WIDTH - 0.02, 0.014, DEPTH - 0.05);
  const glassEdgeGeo = new THREE.BoxGeometry(INNER_WIDTH - 0.02, 0.008, 0.012);
  const trimGeo = new RoundedBoxGeometry(INNER_WIDTH, LIP_HEIGHT * 0.78, 0.03, 2, 0.008);
  const uprightGeo = new RoundedBoxGeometry(UPRIGHT_THICKNESS, 1, DEPTH + 0.06, 2, 0.012); // scaled in y
  const backGeo = new THREE.PlaneGeometry(INNER_WIDTH + 0.02, 1); // scaled in y
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const headerGeo = new RoundedBoxGeometry(INNER_WIDTH + 0.01, 1, 0.06, 3, 0.02); // scaled in y

  const wood = new THREE.MeshStandardMaterial({ color: COLORS.wood, map: grain, roughness: 0.72, metalness: 0 });
  const darkWood = new THREE.MeshStandardMaterial({ color: COLORS.darkWood, map: grain, roughness: 0.7 });
  const backWood = new THREE.MeshStandardMaterial({ color: COLORS.backWood, map: beadboard, roughness: 0.85 });
  const labelPaint = new THREE.MeshStandardMaterial({ color: COLORS.labelPaint, roughness: 0.9 });
  const labelHighlight = new THREE.MeshStandardMaterial({ color: "#E9BC8A", roughness: 0.8 });

  const steel = new THREE.MeshStandardMaterial({ color: COLORS.steel, roughness: 0.32, metalness: 0.75 });
  const steelDark = new THREE.MeshStandardMaterial({ color: COLORS.steelDark, roughness: 0.4, metalness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: "#E8ECEF", roughness: 0.15, metalness: 0.95 });
  const fridgeWall = new THREE.MeshStandardMaterial({
    color: COLORS.fridgeWall,
    roughness: 0.55,
    emissive: "#DDEBF5",
    emissiveIntensity: 0.12,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: COLORS.glass,
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const glassEdge = new THREE.MeshStandardMaterial({
    color: COLORS.glassEdge,
    emissive: "#9FE3FF",
    emissiveIntensity: 0.7,
    roughness: 0.1,
  });
  const led = new THREE.MeshStandardMaterial({ color: COLORS.led, emissive: "#EAF6FF", emissiveIntensity: 1.6 });
  const fridgeLabel = new THREE.MeshStandardMaterial({ color: "#2F3A44", roughness: 0.6 });

  const frostWall = new THREE.MeshStandardMaterial({
    color: COLORS.freezerWall,
    map: frost,
    roughness: 0.9,
    emissive: "#9CC9E8",
    emissiveIntensity: 0.18,
  });
  const frostGlass = new THREE.MeshStandardMaterial({
    color: "#E6F7FF",
    map: frost,
    roughness: 0.6,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const frostTrim = new THREE.MeshStandardMaterial({ color: "#F4FBFF", roughness: 0.5 });
  const frostLabel = new THREE.MeshStandardMaterial({ color: COLORS.frostLabel, roughness: 0.7 });
  const iceLed = new THREE.MeshStandardMaterial({ color: "#DDF3FF", emissive: "#8FD3FF", emissiveIntensity: 1.4 });
  const sparkleMat = new THREE.PointsMaterial({
    map: sparkle,
    color: "#FFFFFF",
    size: 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mistMat = new THREE.MeshBasicMaterial({
    map: mist,
    color: "#E8F6FF",
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });

  return {
    textures: { grain, beadboard, frost, sparkle, mist },
    geometries: {
      board: boardGeo,
      lip: lipGeo,
      glass: glassGeo,
      glassEdge: glassEdgeGeo,
      trim: trimGeo,
      upright: uprightGeo,
      back: backGeo,
      unitBox,
      unitPlane,
      header: headerGeo,
    },
    materials: {
      wood,
      darkWood,
      backWood,
      labelPaint,
      labelHighlight,
      steel,
      steelDark,
      chrome,
      fridgeWall,
      glass,
      glassEdge,
      led,
      fridgeLabel,
      frostWall,
      frostGlass,
      frostTrim,
      frostLabel,
      iceLed,
      sparkle: sparkleMat,
      mist: mistMat,
    },
  };
}

export function shelfAssets() {
  if (!cache) cache = build();
  return cache;
}
