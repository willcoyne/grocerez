/**
 * Neon theme textures (optional extras for the theme core / scene builders). Pure RGBA generators, tileable and
 * deterministic; wrap with `imageToDataTexture` (sRGB) and use as `map` + `emissiveMap`.
 * - neonGridImage: the synthwave floor: near-black navy with glowing magenta grid lines (bright core + soft halo).
 * - neonTubeImage: a horizontal strip with a neon tube profile (white-hot core, coloured glow), tiling along U,
 *   for shelf lips, baseboards and furniture edges.
 * - neonWallImage: dark wall panels with faint violet seams and a little noise, so the dark room isn't flat.
 * Owner: neon theme designer.
 */
import { clamp255, hexRgb, makeImage, mixRgb, mulberry32, setPixel, tileNoise, type RGB, type ThemeImage } from "../sketch/textureImage";

export type NeonGridOptions = { size?: number; cells?: number; base?: string; line?: string; seed?: number };

export function neonGridImage({ size = 256, cells = 4, base = "#0B0A1F", line = "#FF3FD8", seed = 21 }: NeonGridOptions = {}): ThemeImage {
  if (size % cells !== 0) throw new Error(`cells ${cells} must divide size ${size}`);
  const img = makeImage(size, size);
  const step = size / cells;
  const b = hexRgb(base), l = hexRgb(line);
  const hot: RGB = mixRgb(l, [255, 255, 255], 0.55);
  const noise = tileNoise(size, 16, mulberry32(seed));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x % step, step - (x % step));
      const dy = Math.min(y % step, step - (y % step));
      const d = Math.min(dx, dy);
      const core = Math.max(0, 1 - d / 1.2);
      const halo = Math.exp(-(d * d) / (2 * 4.5 * 4.5)) * 0.55;
      let c = mixRgb(b, l, Math.min(1, halo + core));
      c = mixRgb(c, hot, core * 0.8);
      const n = 0.92 + 0.08 * noise(x, y);
      setPixel(img, x, y, [clamp255(c[0] * n), clamp255(c[1] * n), clamp255(c[2] * n)]);
    }
  return img;
}

export type NeonTubeOptions = { width?: number; height?: number; color?: string; base?: string };

export function neonTubeImage({ width = 64, height = 32, color = "#21E6FF", base = "#0B0A1F" }: NeonTubeOptions = {}): ThemeImage {
  const img = makeImage(width, height);
  const c = hexRgb(color), b = hexRgb(base);
  const hot: RGB = mixRgb(c, [255, 255, 255], 0.7);
  const mid = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    const d = Math.abs(y - mid) / (height / 2); // 0 centre .. 1 edge
    const glow = Math.exp(-(d * d) / (2 * 0.32 * 0.32));
    const core = Math.max(0, 1 - d / 0.16);
    const px = mixRgb(mixRgb(b, c, glow), hot, core);
    for (let x = 0; x < width; x++) setPixel(img, x, y, [clamp255(px[0]), clamp255(px[1]), clamp255(px[2])]);
  }
  return img;
}

export type NeonWallOptions = { size?: number; panels?: number; base?: string; seam?: string; seed?: number };

export function neonWallImage({ size = 128, panels = 2, base = "#120F2E", seam = "#5A2DB8", seed = 5 }: NeonWallOptions = {}): ThemeImage {
  if (size % panels !== 0) throw new Error(`panels ${panels} must divide size ${size}`);
  const img = makeImage(size, size);
  const step = size / panels;
  const b = hexRgb(base), s = hexRgb(seam);
  const rand = mulberry32(seed);
  const n1 = tileNoise(size, 8, rand), n2 = tileNoise(size, 32, rand);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.min(x % step, step - (x % step), y % step, step - (y % step));
      const seamT = Math.max(0, 1 - d / 1.5) * 0.6;
      const n = 0.88 + 0.08 * n1(x, y) + 0.06 * n2(x, y);
      const c = mixRgb(b, s, seamT);
      setPixel(img, x, y, [clamp255(c[0] * n), clamp255(c[1] * n), clamp255(c[2] * n)]);
    }
  return img;
}

export const neonTextureImages = {
  grid: () => neonGridImage(),
  tubeCyan: () => neonTubeImage(),
  tubeMagenta: () => neonTubeImage({ color: "#FF3FD8" }),
  wall: () => neonWallImage(),
} as const;
