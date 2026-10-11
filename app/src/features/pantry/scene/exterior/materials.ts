// Shared, lazily-created textures and materials for the exterior. Procedural DataTextures only (no image files),
// which upload fine through expo-gl on native as well as WebGL on web.
import {
  Color,
  DataTexture,
  DoubleSide,
  LinearMipmapLinearFilter,
  LinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

export const PALETTE = {
  wood: "#C68B59",
  woodDark: "#8B5A2B",
  woodLight: "#E0B07A",
  crown: "#BA7F4E",
  slat: "#CF9766",
  interior: "#5A3A22",
  wall: "#F3E9DC",
  cream: "#FFF8EE",
  ink: "#2B2730",
  brass: "#D2A24C",
  terracotta: "#C96B43",
  soil: "#4A3326",
  leaf: "#4E9A51",
  leafDark: "#2E7D32",
  leafLight: "#7CB867",
  pin: "#E2483D",
  nail: "#55504B",
  string: "#8A6A4F",
  floor: "#B9804F",
} as const;

// --- tiny deterministic noise -------------------------------------------------------------------
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Smooth periodic 1-D noise table of length n (wraps). */
function smoothTable(n: number, seed: number, passes = 3): Float32Array {
  const r = rng(seed);
  let t = new Float32Array(n).map(() => r());
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) next[i] = (t[(i - 1 + n) % n] + t[i] * 2 + t[(i + 1) % n]) / 4;
    t = next;
  }
  return t;
}

const TAU = Math.PI * 2;

function finishTexture(tex: DataTexture, colorSpace: typeof SRGBColorSpace | typeof NoColorSpace) {
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Grey wood-grain multiplier (≈0.72..1.0), grain running along V. Tileable: every term is periodic in u and v.
 * Tinted by vertex colours / material colour.
 */
function makeGrainTexture(size = 128): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const fibre = smoothTable(size, 7, 1).map((f) => f * f * 1.6);
  const fine = rng(11);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // long, gently meandering grain lines + fine fibre streaks
      const warp = 0.22 * Math.sin(TAU * (v + 0.5 * u)) + 0.08 * Math.sin(TAU * (3 * v + u) + 1.7);
      const t = u * 5 + warp;
      const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * t), 6); // thin dark late-wood lines
      const val = 1 - 0.12 * ring - 0.11 * fibre[x] - 0.02 * fine();
      const c = Math.max(0, Math.min(255, Math.round(val * 255)));
      const i = (y * size + x) * 4;
      data[i] = c;
      data[i + 1] = Math.round(c * 0.985);
      data[i + 2] = Math.round(c * 0.96);
      data[i + 3] = 255;
    }
  }
  return finishTexture(new DataTexture(data, size, size, RGBAFormat, UnsignedByteType), NoColorSpace);
}

/** Floor planks running along X: 4 planks per tile with staggered butt joints, gaps and grain. sRGB. */
function makeFloorTexture(size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const base = new Color(PALETTE.floor);
  const r = rng(23);
  const planks = 4;
  const tones = Array.from({ length: planks }, () => 0.86 + r() * 0.22);
  const seams = Array.from({ length: planks }, () => r());
  const fibre = smoothTable(size, 31, 1);
  const fine = rng(5);
  const bandH = size / planks;
  const hex = base.getHexString();
  const br = parseInt(hex.slice(0, 2), 16);
  const bg = parseInt(hex.slice(2, 4), 16);
  const bb = parseInt(hex.slice(4, 6), 16);
  for (let y = 0; y < size; y++) {
    const band = Math.floor(y / bandH);
    const inBand = (y % bandH) / bandH;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // grain along u inside each plank
      const warp = 0.18 * Math.sin(TAU * (u * 2 + band * 0.3)) + 0.06 * Math.sin(TAU * u * 5 + band);
      const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * (inBand * 3 + warp)), 5);
      let val = tones[band] * (1 - 0.14 * ring - 0.05 * fibre[y] - 0.03 * fine());
      // gap between planks (top edge of every band) with a soft bevel shadow
      const edge = y % bandH;
      if (edge < 2) val *= 0.45;
      else if (edge < 4) val *= 0.82;
      else if (edge > bandH - 3) val *= 1.06;
      // butt joints, two per plank per tile
      const su = (u - seams[band] + 1) % 0.5;
      if (su < 1.5 / size) val *= 0.5;
      else if (su < 3 / size) val *= 0.85;
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, Math.round(br * val));
      data[i + 1] = Math.min(255, Math.round(bg * val));
      data[i + 2] = Math.min(255, Math.round(bb * val));
      data[i + 3] = 255;
    }
  }
  return finishTexture(new DataTexture(data, size, size, RGBAFormat, UnsignedByteType), SRGBColorSpace);
}

export type ExteriorMaterials = {
  /** all wood: vertex-tinted, grain map. */
  wood: MeshStandardMaterial;
  /** painted / non-wood static bits (pot, soil, baseboard, pin, nail): vertex-tinted. */
  paint: MeshStandardMaterial;
  leaf: MeshStandardMaterial;
  knob: MeshStandardMaterial;
  wall: MeshStandardMaterial;
  floor: MeshStandardMaterial;
  paper: MeshStandardMaterial;
  ink: MeshStandardMaterial;
  hit: MeshBasicMaterial;
};

let mats: ExteriorMaterials | null = null;

export function getMaterials(): ExteriorMaterials {
  if (mats) return mats;
  const grain = makeGrainTexture();
  const floorTex = makeFloorTexture();
  floorTex.repeat.set(16 / 1.0, 10 / 1.0);
  mats = {
    wood: new MeshStandardMaterial({ color: "#ffffff", vertexColors: true, map: grain, roughness: 0.68, metalness: 0 }),
    paint: new MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.78, metalness: 0 }),
    leaf: new MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.6, flatShading: true }),
    knob: new MeshStandardMaterial({
      color: PALETTE.brass,
      metalness: 0.55,
      roughness: 0.32,
      emissive: new Color("#FFB04A"),
      emissiveIntensity: 0,
    }),
    wall: new MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.95 }),
    floor: new MeshStandardMaterial({ map: floorTex, roughness: 0.72 }),
    paper: new MeshStandardMaterial({ color: PALETTE.cream, roughness: 0.9, side: DoubleSide }),
    ink: new MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.8 }),
    // Invisible but raycastable tap target.
    hit: new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }),
  };
  return mats;
}
