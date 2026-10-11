// Procedural DataTextures for the room props (no image files, no DOM canvas, so they upload through expo-gl on native
// as well as WebGL on web). Created lazily once and shared. Only roomMaterials.ts should call these.
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise on a `cells` x `cells` lattice over [0,1)². */
function periodicNoise(cells: number, seed: number) {
  const r = rng(seed);
  const grid = new Float32Array(cells * cells).map(() => r());
  return (u: number, v: number) => {
    const gx = u * cells;
    const gy = v * cells;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (ix: number, iy: number) => grid[(((iy % cells) + cells) % cells) * cells + (((ix % cells) + cells) % cells)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

type Px = [number, number, number];

function build(size: number, srgb: boolean, fill: (u: number, v: number, x: number, y: number) => Px): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fill(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const cache: Partial<Record<string, DataTexture>> = {};
function once(key: string, make: () => DataTexture): DataTexture {
  return (cache[key] ??= make());
}

/**
 * Cork: grey multiplier (tinted by the material colour) with granules, pits and lighter flecks. Tileable; mapped at
 * ~0.5 m per tile by the cork-board UVs.
 */
export function corkTexture(): DataTexture {
  return once("cork", () => {
    const big = periodicNoise(10, 3);
    const mid = periodicNoise(40, 5);
    const fine = periodicNoise(96, 9);
    const r = rng(17);
    return build(256, false, (u, v) => {
      let k = 0.86 + 0.1 * big(u, v) + 0.14 * (mid(u, v) - 0.5) + 0.16 * (fine(u, v) - 0.5);
      const s = r();
      if (s < 0.035) k *= 0.58; // dark pits
      else if (s < 0.06) k *= 1.12; // light flecks
      k = Math.min(1, k);
      return [k, k * 0.97, k * 0.92];
    });
  });
}

/** Chalkboard slate (sRGB colour, 0..1 across the board): dark green-grey with eraser haze and chalk dust. */
export function slateTexture(): DataTexture {
  return once("slate", () => {
    const haze = periodicNoise(5, 21);
    const blot = periodicNoise(14, 23);
    const grain = periodicNoise(128, 29);
    return build(256, true, (u, v) => {
      // sweeping eraser arcs + soft blotches of dust
      const arc = Math.pow(0.5 + 0.5 * Math.sin((u * 3.2 + Math.sin(v * 6.28) * 0.35) * Math.PI * 2), 8) * 0.5;
      const dust = Math.max(0, haze(u, v) - 0.45) * 0.55 + Math.max(0, blot(u, v) - 0.62) * 0.6 + arc * haze(v, u) * 0.6;
      const g = (grain(u, v) - 0.5) * 0.05;
      const base: Px = [0.2 + g, 0.25 + g, 0.23 + g];
      const d = Math.min(0.32, dust * 0.5);
      return [base[0] + d, base[1] + d * 0.98, base[2] + d * 0.95];
    });
  });
}

/** Chalk: grey multiplier speckle (powdery strokes). */
export function chalkTexture(): DataTexture {
  return once("chalk", () => {
    const n = periodicNoise(48, 41);
    const r = rng(43);
    return build(64, false, (u, v) => {
      const k = 0.82 + 0.18 * n(u, v) - (r() < 0.12 ? 0.22 : 0);
      return [k, k, k];
    });
  });
}

/** Woven cloth: grey multiplier with a fine plain weave and gentle mottling (apron, book cloth, felt). */
export function clothTexture(): DataTexture {
  return once("cloth", () => {
    const mott = periodicNoise(6, 51);
    const fib = periodicNoise(64, 53);
    return build(128, false, (u, v, x, y) => {
      const warp = 0.5 + 0.5 * Math.sin(((x + (y % 2)) * Math.PI) / 2);
      const weft = 0.5 + 0.5 * Math.sin(((y + (x % 2)) * Math.PI) / 2);
      const k = 0.88 + 0.05 * (warp * weft) + 0.05 * (mott(u, v) - 0.5) + 0.05 * (fib(u, v) - 0.5);
      return [k, k, k];
    });
  });
}

/** Paper: very subtle fibre multiplier (cards, polaroids, calendar, book pages). */
export function paperTexture(): DataTexture {
  return once("paper", () => {
    const f = periodicNoise(64, 61);
    const g = periodicNoise(12, 67);
    return build(128, false, (u, v) => {
      const k = 0.955 + 0.03 * f(u, v) + 0.015 * g(u, v);
      return [k, k, k];
    });
  });
}

/** Free the cached textures (theme switch); the next call rebuilds them. */
export function disposeRoomTextures() {
  for (const key of Object.keys(cache)) {
    cache[key]?.dispose();
    delete cache[key];
  }
}
