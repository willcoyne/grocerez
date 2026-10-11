/**
 * Sketch theme textures (optional extras for the theme core / scene builders). Pure RGBA generators, tileable and
 * deterministic; wrap with `imageToDataTexture`.
 * - paperImage: off-white drawing paper (soft blotches, fibres, specks), for the wall / background / paper props.
 * - hatchImage: hand-drawn ink hatching on paper at three densities (1 = single diagonal, 2 = cross-hatch,
 *   3 = cross-hatch + horizontals), for shading with the "ink" material: lighter surfaces use lower levels.
 * Owner: sketch theme designer.
 */
import {
  clamp255,
  hexRgb,
  makeImage,
  mixRgb,
  mulberry32,
  segDist,
  setPixel,
  tileNoise,
  type ThemeImage,
} from "./textureImage";

export type PaperOptions = { size?: number; tint?: string; seed?: number };

export function paperImage({ size = 256, tint = "#F7F4EC", seed = 7 }: PaperOptions = {}): ThemeImage {
  const img = makeImage(size, size);
  const rand = mulberry32(seed);
  const blot = tileNoise(size, 6, rand);
  const tooth = tileNoise(size, 64, rand);
  const base = hexRgb(tint);
  const shade = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) shade[y * size + x] = 1 - 0.035 * blot(x, y) - 0.03 * tooth(x, y);
  // fibres: short faint strokes, wrapped so the tile is seamless
  for (let f = 0; f < size * 0.6; f++) {
    const x0 = rand() * size, y0 = rand() * size;
    const ang = rand() * Math.PI, len = 4 + rand() * 14;
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    const depth = 0.02 + rand() * 0.035;
    const minX = Math.floor(Math.min(x0, x1)) - 1, maxX = Math.ceil(Math.max(x0, x1)) + 1;
    const minY = Math.floor(Math.min(y0, y1)) - 1, maxY = Math.ceil(Math.max(y0, y1)) + 1;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const cover = 1 - segDist(x, y, x0, y0, x1, y1);
        if (cover <= 0) continue;
        const i = (((y % size) + size) % size) * size + (((x % size) + size) % size);
        shade[i] -= depth * cover;
      }
  }
  for (let k = 0; k < size / 4; k++) {
    const i = Math.floor(rand() * size * size);
    shade[i] -= 0.06 + rand() * 0.08; // specks
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const s = shade[y * size + x];
      setPixel(img, x, y, [clamp255(base[0] * s), clamp255(base[1] * s), clamp255(base[2] * s)]);
    }
  return img;
}

export type HatchOptions = {
  size?: number;
  /** 1 single diagonal, 2 cross-hatch, 3 cross-hatch + horizontals */
  level?: 1 | 2 | 3;
  /** line spacing in pixels (must divide size) */
  spacing?: number;
  ink?: string;
  paper?: string;
  seed?: number;
};

export function hatchImage({
  size = 128,
  level = 1,
  spacing = 8,
  ink = "#1E1D1A",
  paper = "#FFFFFF",
  seed = 3,
}: HatchOptions = {}): ThemeImage {
  if (size % spacing !== 0) throw new Error(`hatch spacing ${spacing} must divide size ${size}`);
  const img = makeImage(size, size);
  const rand = mulberry32(seed + level * 101);
  const inkRgb = hexRgb(ink), paperRgb = hexRgb(paper);
  type Family = { dir: (x: number, y: number) => number; along: (x: number, y: number) => number; scale: number };
  const all: Family[] = [
    { dir: (x, y) => x + y, along: (x, y) => x - y, scale: Math.SQRT1_2 },
    { dir: (x, y) => x - y + size, along: (x, y) => x + y, scale: Math.SQRT1_2 },
    { dir: (_x, y) => y, along: (x) => x, scale: 1 },
  ];
  const families = all.slice(0, level);
  const wobble = families.map(() => ({ ph: rand() * Math.PI * 2, k: 1 + Math.floor(rand() * 3) }));
  const gaps = families.map(() => tileNoise(size, 16, rand));
  const weight = families.map(() => tileNoise(size, 8, rand));
  const halfW = 0.55; // ~1.1 px pen
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let cover = 0;
      families.forEach((f, k) => {
        const w = wobble[k];
        const wob = 0.9 * Math.sin((Math.PI * 2 * w.k * f.along(x, y)) / size + w.ph);
        const t = (f.dir(x, y) + wob) / spacing;
        const d = Math.abs(t - Math.round(t)) * spacing * f.scale;
        let c = Math.max(0, Math.min(1, halfW + 0.5 - d));
        if (gaps[k](x, y) > 0.78) c *= 0.15; // pen lifts
        c *= 0.7 + 0.3 * weight[k](x, y);
        cover = Math.max(cover, c);
      });
      const [r, g, b] = mixRgb(paperRgb, inkRgb, cover);
      setPixel(img, x, y, [clamp255(r), clamp255(g), clamp255(b)]);
    }
  return img;
}

/** All sketch images by name (generated lazily by callers; this just lists the defaults). */
export const sketchTextureImages = {
  paper: () => paperImage(),
  hatchLight: () => hatchImage({ level: 1 }),
  hatchMedium: () => hatchImage({ level: 2 }),
  hatchDark: () => hatchImage({ level: 3 }),
} as const;
