import neon, { neonGridImage, neonTubeImage, neonWallImage } from "..";
import { contrastRatio, luminance } from "../../../color";
import retroJson from "../../diner/font.typeface.json";
import { LABEL_CHARS, themeProblems, tilesSeamlessly, type TypefaceJson } from "../../sketch/testkit";

describe("neon theme tokens", () => {
  it("is a complete, valid SceneTheme", () => {
    expect(neon.id).toBe("neon");
    expect(themeProblems(neon)).toEqual([]);
  });

  it("is a dark room: navy background, low ambient, fog", () => {
    expect(luminance(neon.background)).toBeLessThan(0.01);
    expect(luminance(neon.palette.wall)).toBeLessThan(0.02);
    expect(neon.lighting.ambientIntensity ?? 0).toBeLessThanOrEqual(0.1);
    expect(neon.lighting.hemiIntensity).toBeLessThan(0.5);
    expect(neon.fog).not.toBeNull();
  });

  it("glows: bloom, scanline grain, magenta letters and cyan edges on dark rough materials", () => {
    expect(neon.materialStyle).toBe("standard");
    expect(neon.effects.bloom?.strength).toBeGreaterThanOrEqual(0.8);
    expect(neon.effects.grain?.kind).toBe("scanline");
    expect(neon.palette.woodLight).toBe("#FF3FD8");
    expect(neon.palette.trim).toBe("#21E6FF");
    expect(luminance(neon.palette.wood)).toBeLessThan(0.03);
  });

  it("pulses allergens in strong red neon, below 3 flashes per second", () => {
    expect(neon.allergenGlow.style).toBe("pulse");
    expect(neon.allergenGlow.periodS).toBeGreaterThanOrEqual(1);
    expect(neon.palette.allergen).not.toBe(neon.palette.woodLight);
  });

  it("uses dark panels with cyan neon borders, radius 14", () => {
    expect(neon.ui).toMatchObject({ panelBorder: "#21E6FF", radius: 14 });
    expect(contrastRatio(neon.ui.panelBorder, neon.ui.panel)).toBeGreaterThan(7);
  });

  it("uses the retro tube font, which covers every label character", () => {
    expect(neon.font).toBe("retro");
    const glyphs = (retroJson as unknown as TypefaceJson).glyphs;
    for (const ch of LABEL_CHARS) expect(glyphs[ch]).toBeDefined();
  });
});

describe("neon textures", () => {
  it("draws a seamless glowing grid: bright lines, dark cells", () => {
    const img = neonGridImage({ size: 64, cells: 4 });
    expect(tilesSeamlessly(img)).toBe(true);
    const red = (x: number, y: number) => img.data[(y * 64 + x) * 4];
    expect(red(0, 8)).toBeGreaterThan(200); // on a line
    expect(red(8, 8)).toBeLessThan(60); // cell centre stays dark
  });

  it("draws a tube profile: hot centre, dark edges, constant along U", () => {
    const img = neonTubeImage({ width: 8, height: 32 });
    const green = (x: number, y: number) => img.data[(y * 8 + x) * 4 + 1];
    expect(green(0, 16)).toBeGreaterThan(220);
    expect(green(0, 0)).toBeLessThan(80);
    expect(green(7, 16)).toBe(green(0, 16));
  });

  it("draws dark seamless wall panels", () => {
    const img = neonWallImage({ size: 64 });
    expect(tilesSeamlessly(img)).toBe(true);
    expect(img.data[(32 * 64 + 16) * 4]).toBeLessThan(60);
  });
});
