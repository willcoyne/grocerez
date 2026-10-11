import helvetikerJson from "../../../../pantry/scene/fonts/helvetiker_bold.typeface.json";
import diner, { checkerImage, formicaImage } from "..";
import { contrastRatio } from "../../../color";
import fontJson from "../font.typeface.json";
import { themeProblems, tilesSeamlessly, typefaceSuite, type TypefaceJson } from "../../sketch/testkit";

describe("diner theme tokens", () => {
  it("is a complete, valid SceneTheme", () => {
    expect(diner.id).toBe("diner");
    expect(themeProblems(diner)).toEqual([]);
  });

  it("is a glossy toon diner: 3 toon bands, checker floor, no grain, slight vignette", () => {
    expect(diner.materialStyle).toBe("toon");
    expect(diner.toonSteps).toBe(3);
    expect(diner.textureStyle).toBe("checker");
    expect(diner.effects.grain).toBeUndefined();
    expect(diner.effects.vignette?.strength).toBeGreaterThan(0);
    expect(diner.effects.vignette?.strength).toBeLessThanOrEqual(0.3);
    expect(diner.font).toBe("retro");
  });

  it("uses mint, cherry red, cream and chrome with a black-and-white floor", () => {
    expect(diner.palette.wood).toBe("#A8E6CF");
    expect(diner.palette.woodDark).toBe("#D7263D");
    expect(diner.palette.wall).toBe("#FFF3D6");
    expect(contrastRatio(diner.palette.floor, diner.palette.floorAlt)).toBeGreaterThan(12);
  });

  it("keeps the allergen colour apart from the cherry trim", () => {
    expect(diner.palette.allergen).not.toBe(diner.palette.woodDark);
    expect(diner.palette.allergen).not.toBe(diner.palette.accent);
  });

  it("uses cream panels with cherry-red borders and radius 22", () => {
    expect(diner.ui).toMatchObject({ panelBorder: "#D7263D", radius: 22 });
    expect(contrastRatio(diner.ui.panelBorder, diner.ui.panel)).toBeGreaterThan(4.5);
  });
});

describe("diner font (GrocerEZ Retro)", () => {
  typefaceSuite(fontJson as unknown as TypefaceJson, helvetikerJson as unknown as TypefaceJson);
});

describe("diner textures", () => {
  it("draws a seamless black-and-white checkerboard", () => {
    const img = checkerImage({ size: 64, tiles: 4 });
    expect(checkerImage({ size: 64, tiles: 4 }).data).toEqual(img.data);
    expect(tilesSeamlessly(img)).toBe(true);
    const lum = (x: number, y: number) => img.data[(y * 64 + x) * 4];
    expect(lum(8, 8)).toBeGreaterThan(200); // light tile
    expect(lum(24, 8)).toBeLessThan(80); // dark tile
    expect(() => checkerImage({ size: 64, tiles: 3 })).toThrow();
  });

  it("draws seamless boomerang formica on mint", () => {
    const img = formicaImage({ size: 64 });
    expect(img.data.length).toBe(64 * 64 * 4);
    expect(tilesSeamlessly(img)).toBe(true);
  });
});
