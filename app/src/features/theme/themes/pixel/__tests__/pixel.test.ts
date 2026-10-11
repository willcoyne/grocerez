import { NearestFilter, RepeatWrapping, SRGBColorSpace } from "three";

import fontJson from "../font.typeface.json";
import pixel, { PIXEL_PALETTE, pixelTextureImages, pixelTextures } from "../index";

type Glyph = { ha: number; x_min: number; x_max: number; o?: string };
const font = fontJson as unknown as {
  resolution: number;
  familyName: string;
  ascender: number;
  descender: number;
  underlineThickness: number;
  boundingBox: { xMin: number; xMax: number; yMin: number; yMax: number };
  glyphs: Record<string, Glyph>;
};
const PX = 100;

// The app has no @types/node: type the bits of Node this test needs.
declare const __dirname: string;
const { execFileSync } = jest.requireActual<{ execFileSync: (file: string, args: string[], o: { encoding: "utf8" }) => string }>(
  "child_process",
);
const { join } = jest.requireActual<{ join: (...parts: string[]) => string }>("path");

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const HEX = /^#[0-9A-F]{6}$/i;

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("GrocerPixel typeface JSON", () => {
  const required = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), "°"];

  it("has a glyph for every printable ASCII character and the degree sign", () => {
    const missing = required.filter((ch) => !font.glyphs[ch]);
    expect(missing).toEqual([]);
  });

  it("uses the 100-unit pixel grid with cap height = 1 em", () => {
    expect(font.resolution).toBe(700);
    expect(font.ascender).toBe(700);
    expect(font.descender).toBe(-200);
    expect(font.boundingBox.yMax - font.boundingBox.yMin + font.underlineThickness).toBe(1000);
  });

  it("gives every glyph a positive advance = bitmap width + 1px spacing, on the pixel grid", () => {
    for (const [ch, g] of Object.entries(font.glyphs)) {
      expect(g.ha % PX).toBe(0);
      expect(g.ha).toBeGreaterThanOrEqual(2 * PX);
      if (ch !== " ") expect(g.x_max + PX).toBeLessThanOrEqual(g.ha);
    }
    expect(font.glyphs[" "].ha).toBe(3 * PX);
    expect(font.glyphs.A.ha).toBe(6 * PX);
    expect(font.glyphs.i.ha).toBe(4 * PX);
  });

  it("draws glyph outlines only as closed axis-aligned rectangles on the pixel grid", () => {
    for (const [ch, g] of Object.entries(font.glyphs)) {
      if (ch === " ") {
        expect(g.o).toBeUndefined();
        continue;
      }
      const tokens = g.o!.split(" ");
      expect(tokens.length % 12).toBe(0); // m x y + 3 * (l x y)
      for (let i = 0; i < tokens.length; i += 12) {
        expect([tokens[i], tokens[i + 3], tokens[i + 6], tokens[i + 9]]).toEqual(["m", "l", "l", "l"]);
        const nums = [1, 2, 4, 5, 7, 8, 10, 11].map((k) => Number(tokens[i + k]));
        for (const n of nums) expect(Math.abs(n % PX)).toBe(0);
        const [x0, y0, x1, y1, x2, y2, x3, y3] = nums;
        // bottom-left -> top-left -> top-right -> bottom-right (clockwise, y up)
        expect([x1, y1 > y0, y2, x2 > x1, x3, y3]).toEqual([x0, true, y1, true, x2, y0]);
        expect(y0).toBeGreaterThanOrEqual(font.boundingBox.yMin);
        expect(y1).toBeLessThanOrEqual(font.boundingBox.yMax);
      }
    }
  });

  it("is up to date with buildFont.mjs", () => {
    const script = join(__dirname, "..", "buildFont.mjs");
    const out = execFileSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    expect(out).toContain("up to date");
  });
});

describe("pixel theme", () => {
  it("is the pixel-art SceneTheme", () => {
    expect(pixel.id).toBe("pixel");
    expect(pixel.materialStyle).toBe("flat");
    expect(pixel.textureStyle).toBe("pixel");
    expect(pixel.toneMapping).toBe("none");
    expect(pixel.font).toBe("pixel");
    expect(pixel.allergenGlow.style).toBe("blink");
    expect(pixel.effects.pixelate!.pixelSize).toBeGreaterThanOrEqual(2);
    expect(pixel.effects.posterize!.levels).toBeGreaterThanOrEqual(5);
    expect(pixel.ui.radius).toBe(0);
    expect(pixel.ui.pixelBorders).toBe(true);
  });

  it("uses valid 6-digit hex colours everywhere", () => {
    const colours = [
      ...Object.values(pixel.palette),
      ...pixel.swatches,
      pixel.background,
      pixel.fog!.color,
      pixel.lighting.keyColor,
      pixel.lighting.fillColor,
      pixel.lighting.hemiSky,
      pixel.lighting.hemiGround,
      pixel.lighting.ambientColor!,
      pixel.lighting.fridgeLight,
      pixel.lighting.freezerLight,
      ...Object.values(pixel.ui).filter((v): v is string => typeof v === "string"),
    ];
    for (const c of colours) expect(c).toMatch(HEX);
    expect(pixel.swatches.length).toBeGreaterThanOrEqual(4);
    expect(pixel.swatches.length).toBeLessThanOrEqual(5);
  });

  it("keeps overlay text readable (WCAG AA)", () => {
    const { ui, palette } = pixel;
    expect(contrast(ui.text, ui.panel)).toBeGreaterThanOrEqual(7);
    expect(contrast(ui.textMuted, ui.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ui.accent, ui.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ui.buttonIcon, ui.buttonFace)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ui.panelBorder, ui.panel)).toBeGreaterThanOrEqual(3);
    expect(contrast(palette.ink, palette.paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(palette.allergen, palette.paper)).toBeGreaterThanOrEqual(3);
  });

  it("blinks the allergen glow slower than 3 flashes per second", () => {
    expect(pixel.allergenGlow.periodS).toBeGreaterThanOrEqual(1 / 3);
  });
});

describe("pixel textures", () => {
  const kinds = Object.keys(pixelTextureImages) as (keyof typeof pixelTextureImages)[];

  it.each(kinds)("%s is a nearest-filtered, mipmap-free, repeating sRGB DataTexture", (kind) => {
    const tex = pixelTextures[kind]();
    expect(tex.magFilter).toBe(NearestFilter);
    expect(tex.minFilter).toBe(NearestFilter);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.wrapS).toBe(RepeatWrapping);
    expect(tex.wrapT).toBe(RepeatWrapping);
    expect(tex.colorSpace).toBe(SRGBColorSpace);
    expect(tex.userData.texelsPerUnit).toBe(32);
    tex.dispose();
  });

  it.each(kinds)("%s is deterministic, opaque and uses a small pixel-art palette", (kind) => {
    const a = pixelTextureImages[kind]();
    const b = pixelTextureImages[kind]();
    expect(sameBytes(a.data, b.data)).toBe(true);
    expect(a.data.length).toBe(a.width * a.height * 4);
    const colours = new Set<string>();
    for (let i = 0; i < a.data.length; i += 4) {
      expect(a.data[i + 3]).toBe(255);
      colours.add(`${a.data[i]},${a.data[i + 1]},${a.data[i + 2]}`);
    }
    expect(colours.size).toBeGreaterThanOrEqual(4);
    expect(colours.size).toBeLessThanOrEqual(16);
  });

  it("luma mode gives grey multipliers that never exceed white", () => {
    const img = pixelTextureImages.woodPlanks({ mode: "luma" });
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(img.data[i + 1]);
      expect(img.data[i]).toBe(img.data[i + 2]);
    }
    expect(pixelTextures.wood({ mode: "luma" }).colorSpace).not.toBe(SRGBColorSpace);
  });

  it("plank seams repeat with the plank height so tiles wrap seamlessly", () => {
    const img = pixelTextureImages.floorBoards();
    const row = (y: number) => img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
    // every 8th row is a full-width dark seam, including row 0 (so the tile's bottom edge meets the next tile's seam)
    for (let y = 0; y < img.height; y += 8) {
      const r = row(y);
      for (let x = 1; x < img.width; x++) expect(r[x * 4]).toBe(r[0]);
    }
    expect(img.height % 8).toBe(0);
  });

  it("follows palette overrides", () => {
    const base = pixelTextureImages.wallpaper();
    const blue = pixelTextureImages.wallpaper({ palette: { wall: "#3355AA" } });
    expect(sameBytes(base.data, blue.data)).toBe(false);
    expect(PIXEL_PALETTE.wall).toMatch(HEX);
  });
});
