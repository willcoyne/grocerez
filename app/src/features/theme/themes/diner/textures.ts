/**
 * Diner theme textures (optional extras for the theme core / scene builders). Pure RGBA generators, tileable and
 * deterministic; wrap with `imageToDataTexture`.
 * - checkerImage: black-and-white checkerboard linoleum with thin grout, faint mottling and wax sheen.
 * - formicaImage: 1950s "boomerang" laminate (mint with pink / charcoal / cream boomerangs and gold flecks), for
 *   shelf tops and counters.
 * Owner: diner theme designer.
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
  type RGB,
  type ThemeImage,
} from "../sketch/textureImage";

export type CheckerOptions = {
  size?: number;
  /** tiles per side (even, so the texture repeats seamlessly) */
  tiles?: number;
  light?: string;
  dark?: string;
  grout?: string;
  seed?: number;
};

export function checkerImage({
  size = 256,
  tiles = 4,
  light = "#F7F5EE",
  dark = "#1B1B1F",
  grout = "#9A968C",
  seed = 50,
}: CheckerOptions = {}): ThemeImage {
  if (tiles % 2 !== 0 || size % tiles !== 0) throw new Error(`tiles ${tiles} must be even and divide size ${size}`);
  const img = makeImage(size, size);
  const step = size / tiles;
  const L = hexRgb(light), D = hexRgb(dark), G = hexRgb(grout);
  const rand = mulberry32(seed);
  const mottle = tileNoise(size, 16, rand), sheen = tileNoise(size, 4, rand);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / step), ty = Math.floor(y / step);
      const isDark = (tx + ty) % 2 === 1;
      let c: RGB = isDark ? D : L;
      const m = mottle(x, y) - 0.5;
      c = isDark ? mixRgb(c, [70, 70, 78], 0.25 + m * 0.3) : mixRgb(c, [222, 217, 204], 0.25 + m * 0.4);
      c = mixRgb(c, [255, 255, 255], Math.max(0, sheen(x, y) - 0.62) * 0.35);
      const gx = Math.min(x % step, step - 1 - (x % step));
      const gy = Math.min(y % step, step - 1 - (y % step));
      if (Math.min(gx, gy) < 1) c = mixRgb(c, G, 0.55);
      setPixel(img, x, y, [clamp255(c[0]), clamp255(c[1]), clamp255(c[2])]);
    }
  return img;
}

export type FormicaOptions = { size?: number; base?: string; colors?: string[]; fleck?: string; seed?: number };

export function formicaImage({
  size = 256,
  base = "#A8E6CF",
  colors = ["#F48FB1", "#2F2A2E", "#FFF3D6"],
  fleck = "#D4AF37",
  seed = 1955,
}: FormicaOptions = {}): ThemeImage {
  const img = makeImage(size, size);
  const rand = mulberry32(seed);
  const buf: RGB[] = Array.from({ length: size * size }, () => hexRgb(base));
  const tex = tileNoise(size, 32, rand);
  // Paint a thick stroke with wrap-around so the tile is seamless.
  const stroke = (ax: number, ay: number, bx: number, by: number, w: number, rgb: RGB) => {
    const x0 = Math.floor(Math.min(ax, bx) - w - 1), x1 = Math.ceil(Math.max(ax, bx) + w + 1);
    const y0 = Math.floor(Math.min(ay, by) - w - 1), y1 = Math.ceil(Math.max(ay, by) + w + 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cover = Math.max(0, Math.min(1, w + 0.5 - segDist(x, y, ax, ay, bx, by)));
        if (!cover) continue;
        const i = (((y % size) + size) % size) * size + (((x % size) + size) % size);
        buf[i] = mixRgb(buf[i], rgb, cover);
      }
  };
  const count = Math.round((size * size) / 2600);
  for (let k = 0; k < count; k++) {
    const cx = rand() * size, cy = rand() * size;
    const ang = rand() * Math.PI * 2, arm = size * (0.05 + rand() * 0.04), bend = 0.9 + rand() * 0.5;
    const rgb = hexRgb(colors[k % colors.length]);
    const w = 1.6 + rand() * 1.4;
    // boomerang: two arms meeting at the elbow (cx, cy)
    stroke(cx, cy, cx + Math.cos(ang) * arm, cy + Math.sin(ang) * arm, w, rgb);
    stroke(cx, cy, cx + Math.cos(ang + bend) * arm * 0.85, cy + Math.sin(ang + bend) * arm * 0.85, w, rgb);
  }
  const fl = hexRgb(fleck);
  for (let k = 0; k < size * 1.5; k++) {
    const i = Math.floor(rand() * size * size);
    buf[i] = mixRgb(buf[i], fl, 0.85);
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = buf[y * size + x];
      const n = 0.96 + 0.04 * tex(x, y);
      setPixel(img, x, y, [clamp255(c[0] * n), clamp255(c[1] * n), clamp255(c[2] * n)]);
    }
  return img;
}

export const dinerTextureImages = {
  checker: () => checkerImage(),
  formica: () => formicaImage(),
} as const;
