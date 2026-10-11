import helvetikerJson from "../../../../pantry/scene/fonts/helvetiker_bold.typeface.json";
import sketch, { hatchImage, imageToDataTexture, paperImage } from "..";
import fontJson from "../font.typeface.json";
import { themeProblems, tilesSeamlessly, typefaceSuite, type TypefaceJson } from "../testkit";

describe("sketch theme tokens", () => {
  it("is a complete, valid SceneTheme", () => {
    expect(sketch.id).toBe("sketch");
    expect(themeProblems(sketch)).toEqual([]);
  });

  it("is ink on paper: ink materials, hatching, strong 1.5-2 px outlines and paper grain", () => {
    expect(sketch.materialStyle).toBe("ink");
    expect(sketch.textureStyle).toBe("hatch");
    expect(sketch.effects.outline?.color).toBe(sketch.palette.ink);
    expect(sketch.effects.outline?.thickness).toBeGreaterThanOrEqual(1.5);
    expect(sketch.effects.outline?.thickness).toBeLessThanOrEqual(2);
    expect(sketch.effects.outline?.strength ?? 1).toBeGreaterThanOrEqual(0.9);
    expect(sketch.effects.grain?.kind).toBe("paper");
    expect(sketch.effects.bloom).toBeUndefined();
    expect(sketch.font).toBe("hand");
  });

  it("marks allergens with a red marker outline, not a flashing glow", () => {
    expect(sketch.allergenGlow.style).toBe("outline");
    expect(sketch.palette.allergen).toBe("#E0312B");
  });

  it("uses a notebook UI: white paper panels, 2px black ink borders, radius 6", () => {
    expect(sketch.ui).toMatchObject({ panel: "#FFFFFF", panelBorder: sketch.palette.ink, radius: 6, borderWidth: 2 });
    expect(sketch.ui.fontFamily).toBeNull(); // no handwriting RN font is registered yet (README)
  });
});

describe("sketch font (GrocerEZ Hand)", () => {
  typefaceSuite(fontJson as unknown as TypefaceJson, helvetikerJson as unknown as TypefaceJson);

  it("is the hand-lettered family", () => {
    expect((fontJson as unknown as TypefaceJson).familyName).toBe("GrocerEZ Hand");
  });
});

describe("sketch textures", () => {
  const mean = (img: { data: Uint8Array }) => {
    let s = 0;
    for (let i = 0; i < img.data.length; i += 4) s += img.data[i];
    return s / (img.data.length / 4);
  };

  it("makes deterministic, seamless off-white paper", () => {
    const a = paperImage({ size: 64 });
    expect(a.width).toBe(64);
    expect(a.data.length).toBe(64 * 64 * 4);
    expect(paperImage({ size: 64 }).data).toEqual(a.data);
    expect(tilesSeamlessly(a)).toBe(true);
    expect(mean(a)).toBeGreaterThan(215); // stays paper-light
  });

  it("darkens with each hatching level and tiles seamlessly", () => {
    const [l1, l2, l3] = ([1, 2, 3] as const).map((level) => hatchImage({ size: 64, level }));
    expect(mean(l1)).toBeGreaterThan(mean(l2));
    expect(mean(l2)).toBeGreaterThan(mean(l3));
    for (const img of [l1, l2, l3]) expect(tilesSeamlessly(img)).toBe(true);
    expect(() => hatchImage({ size: 64, spacing: 7 })).toThrow();
  });

  it("wraps images as repeating DataTextures", () => {
    const tex = imageToDataTexture(hatchImage({ size: 32 }));
    expect(tex.image.width).toBe(32);
    expect(tex.generateMipmaps).toBe(true);
  });
});
