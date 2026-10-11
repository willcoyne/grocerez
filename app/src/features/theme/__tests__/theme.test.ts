import { act, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { createElement } from "react";
import { Text } from "react-native";
import {
  ACESFilmicToneMapping,
  DataTexture,
  MeshLambertMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  SRGBColorSpace,
} from "three";

import { storageKeys } from "@/state/storage";

import { themeCanvasProps, themeLights, hasThemeEffects } from "../canvas";
import { isHexColor } from "../color";
import { drawableTextFor, getHelvetikerFont, getThemeFont } from "../fonts";
import {
  MATERIAL_ROLES,
  cachedMaterialCount,
  createThemedMaterial,
  disposeThemeCaches,
  themedMaterial,
  toonGradient,
} from "../materials";
import { DEFAULT_THEME_ID, THEMES, THEME_IDS, getTheme, isThemeId } from "../registry";
import { setActiveThemeId } from "../store";
import { cachedTextureCount, themedTexture, type TextureKind } from "../textures";
import {
  ThemeProvider,
  __resetThemeSessionForTests,
  getActiveTheme,
  useSceneTheme,
  useSetTheme,
  useThemeHydrated,
} from "../ThemeProvider";
import type { MaterialStyle, SceneTheme, TextureStyle, ThemeId } from "../types";

const ALL_IDS: ThemeId[] = ["cozy", "pixel", "sketch", "neon", "diner"];
const KINDS: TextureKind[] = ["wood", "woodPlanks", "floor", "wall", "frost", "paper"];

const PALETTE_KEYS = [
  "wood", "woodDark", "woodLight", "wall", "floor", "floorAlt", "trim", "metal", "fridgeWall", "freezerWall",
  "glass", "paper", "ink", "accent", "allergen", "highlight", "plant", "pot",
] as const;
const LIGHT_COLOR_KEYS = ["keyColor", "fillColor", "hemiSky", "hemiGround", "fridgeLight", "freezerLight"] as const;
const UI_COLOR_KEYS = ["panel", "panelBorder", "text", "textMuted", "accent", "buttonFace", "buttonRing", "buttonIcon"] as const;

/** A theme with a given style, built from cozy (independent of the designers' choices). */
function variant(id: ThemeId, materialStyle: MaterialStyle, textureStyle: TextureStyle): SceneTheme {
  return { ...THEMES.cozy, id, materialStyle, textureStyle, toonSteps: 3 };
}

describe("registry", () => {
  it("has every ThemeId, keyed by its own id, cozy default", () => {
    expect([...THEME_IDS].sort()).toEqual([...ALL_IDS].sort());
    for (const id of ALL_IDS) {
      expect(THEMES[id]).toBeDefined();
      expect(THEMES[id].id).toBe(id);
    }
    expect(DEFAULT_THEME_ID).toBe("cozy");
    expect(isThemeId("neon")).toBe(true);
    expect(isThemeId("vaporwave")).toBe(false);
    expect(getTheme("nope").id).toBe("cozy");
  });

  it.each(ALL_IDS)("%s: required tokens are valid hex colours", (id) => {
    const t = THEMES[id];
    const bad: string[] = [];
    const check = (k: string, v: unknown) => !isHexColor(v) && bad.push(`${k}=${String(v)}`);
    for (const k of PALETTE_KEYS) check(`palette.${k}`, t.palette[k]);
    if (t.palette.knob !== undefined) check("palette.knob", t.palette.knob);
    for (const k of LIGHT_COLOR_KEYS) check(`lighting.${k}`, t.lighting[k]);
    if (t.lighting.ambientColor !== undefined) check("lighting.ambientColor", t.lighting.ambientColor);
    for (const k of UI_COLOR_KEYS) check(`ui.${k}`, t.ui[k]);
    check("background", t.background);
    if (t.fog) check("fog.color", t.fog.color);
    if (t.effects.outline) check("effects.outline.color", t.effects.outline.color);
    t.swatches.forEach((s, i) => check(`swatches[${i}]`, s));
    expect(bad).toEqual([]);
    expect(t.swatches.length).toBeGreaterThanOrEqual(4);
    expect(t.swatches.length).toBeLessThanOrEqual(5);
    expect(t.name.length).toBeGreaterThan(0);
    expect(["helvetiker", "pixel", "hand", "retro"]).toContain(t.font);
  });

  it("cozy reproduces the pre-theme scene", () => {
    const c = THEMES.cozy;
    expect(c.materialStyle).toBe("standard");
    expect(c.textureStyle).toBe("grain");
    expect(hasThemeEffects(c)).toBe(false);
    expect(c.palette.wood).toBe("#C68B59");
    expect(c.palette.woodDark).toBe("#8B5A2B");
    expect(c.background).toBe("#F3E9DC");
    expect(c.fog).toEqual({ color: "#F3E9DC", near: 14, far: 30 });
    const p = themeCanvasProps(c);
    expect(p.toneMapping).toBe(ACESFilmicToneMapping);
    expect(p.toneMappingExposure).toBe(1.05);
    expect(p.shadows.enabled).toBe(true);
    expect(themeLights(c)).toEqual({
      hemisphere: { sky: "#FFF4E2", ground: "#8B5A2B", intensity: 0.75 },
      ambient: { color: "#FFE9CF", intensity: 0.18 },
      key: { color: "#FFD9A8", intensity: 2.3, castShadow: true },
      fill: { color: "#FFF1E0", intensity: 0.55 },
      fridge: { color: "#EAF4FF", intensity: 1.8 },
      freezer: { color: "#9FD8FF", intensity: 1.6 },
    });
  });
});

describe("material factory", () => {
  afterEach(() => {
    for (const id of ALL_IDS) disposeThemeCaches(id);
  });

  it.each([
    ["standard", MeshStandardMaterial],
    ["toon", MeshToonMaterial],
    ["flat", MeshLambertMaterial],
    ["ink", MeshLambertMaterial],
  ] as const)("%s style returns the expected class for every role", (style, Cls) => {
    const theme = variant("pixel", style, "grain");
    for (const role of MATERIAL_ROLES) {
      const m = themedMaterial(theme, role);
      expect(m).toBeInstanceOf(Cls);
      // every themed material can glow / dim (no MeshBasicMaterial)
      expect(m.emissive).toBeDefined();
      expect(m.userData.themeRole).toBe(role);
    }
  });

  it("caches per theme + role + overrides and disposes per theme", () => {
    const theme = THEMES.cozy;
    const a = themedMaterial(theme, "wood");
    expect(themedMaterial(theme, "wood")).toBe(a);
    const b = themedMaterial(theme, "wood", { vertexColors: true, roughness: 0.5 });
    expect(b).not.toBe(a);
    // key order doesn't matter
    expect(themedMaterial(theme, "wood", { roughness: 0.5, vertexColors: true })).toBe(b);
    // other themes get their own instances
    expect(themedMaterial(variant("diner", "toon", "checker"), "wood")).not.toBe(a);
    // uncached factory
    const own = createThemedMaterial(theme, "wood");
    expect(own).not.toBe(a);
    own.dispose();

    const spy = jest.spyOn(a, "dispose");
    expect(cachedMaterialCount("cozy")).toBe(2);
    expect(cachedTextureCount("cozy")).toBeGreaterThan(0);
    disposeThemeCaches("cozy");
    expect(spy).toHaveBeenCalled();
    expect(cachedMaterialCount("cozy")).toBe(0);
    expect(cachedTextureCount("cozy")).toBe(0);
    expect(themedMaterial(theme, "wood")).not.toBe(a);
  });

  it("cozy wood keeps the old look: palette colour, grain map, roughness", () => {
    const m = themedMaterial(THEMES.cozy, "wood") as MeshStandardMaterial;
    expect(`#${m.color.getHexString().toUpperCase()}`).toBe("#C68B59");
    expect(m.roughness).toBe(0.68);
    expect(m.map).toBeInstanceOf(DataTexture);
    // exterior: vertex colours carry the tint
    const v = themedMaterial(THEMES.cozy, "wood", { vertexColors: true }) as MeshStandardMaterial;
    expect(v.vertexColors).toBe(true);
    expect(v.color.getHex()).toBe(0xffffff);
    // floor: baked texture -> white material
    const f = themedMaterial(THEMES.cozy, "floor") as MeshStandardMaterial;
    expect(f.color.getHex()).toBe(0xffffff);
    expect(f.map?.userData.baked).toBe(true);
    // wall and paper stay untextured in cozy, glass is transparent
    expect(themedMaterial(THEMES.cozy, "wall").map).toBeNull();
    const g = themedMaterial(THEMES.cozy, "glass");
    expect(g.transparent).toBe(true);
    expect(g.depthWrite).toBe(false);
  });

  it("toon uses a nearest stepped gradient with theme.toonSteps bands", () => {
    const theme = { ...variant("diner", "toon", "none"), toonSteps: 4 };
    const m = themedMaterial(theme, "wall") as MeshToonMaterial;
    expect(m.gradientMap).toBe(toonGradient(4));
    expect((m.gradientMap?.image as { width: number }).width).toBe(4);
    expect(m.gradientMap?.magFilter).toBe(NearestFilter);
  });

  it("flat is faceted Lambert with nearest pixel textures", () => {
    const m = themedMaterial(variant("pixel", "flat", "pixel"), "wood") as MeshLambertMaterial;
    expect(m.flatShading).toBe(true);
    expect(m.map?.magFilter).toBe(NearestFilter);
    expect(m.map?.generateMipmaps).toBe(false);
  });

  it("ink injects world-anchored hatching; ink text is unlit", () => {
    const theme = variant("sketch", "ink", "hatch");
    const m = themedMaterial(theme, "wood") as MeshLambertMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <common>\nvoid main(){\n#include <worldpos_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main(){\n#include <opaque_fragment>\n}",
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain("vInkWorld = ( modelMatrix * inkW ).xyz;");
    expect(shader.fragmentShader).toContain("inkHatchLayer");
    expect(shader.fragmentShader).toContain("#include <opaque_fragment>");
    expect(shader.uniforms.uInkColor).toBeDefined();
    expect(m.customProgramCacheKey()).toBe("theme-ink-v1");

    const ink = themedMaterial(theme, "ink") as MeshLambertMaterial;
    expect(ink.color.getHex()).toBe(0x000000);
    expect(`#${ink.emissive.getHexString().toUpperCase()}`).toBe(theme.palette.ink.toUpperCase());
  });

  it("works for every registered theme", () => {
    for (const id of ALL_IDS) {
      for (const role of MATERIAL_ROLES) expect(themedMaterial(THEMES[id], role)).toBeTruthy();
    }
  });
});

describe("textures", () => {
  afterEach(() => {
    for (const id of ALL_IDS) disposeThemeCaches(id);
  });

  const styles: TextureStyle[] = ["grain", "pixel", "hatch", "checker", "grid", "none"];
  it.each(styles)("%s: every kind is a DataTexture with the colour contract in userData", (style) => {
    const theme = variant("neon", "standard", style);
    for (const kind of KINDS) {
      const t = themedTexture(theme, kind);
      expect(t).toBeInstanceOf(DataTexture);
      expect(t.image.width).toBeGreaterThan(0);
      expect(typeof t.userData.baked).toBe("boolean");
      if (kind === "floor") {
        expect(t.userData.baked).toBe(true);
        expect(t.colorSpace).toBe(SRGBColorSpace);
      }
      if (style === "pixel") {
        expect(t.magFilter).toBe(NearestFilter);
        expect(t.generateMipmaps).toBe(false);
      }
      expect(themedTexture(theme, kind)).toBe(t);
    }
    disposeThemeCaches("neon");
  });

  it("grid floors carry an emissive line mask; repeat variants share the GPU source", () => {
    const theme = variant("neon", "standard", "grid");
    const floor = themedTexture(theme, "floor");
    expect(floor.userData.emissiveMask).toBeInstanceOf(DataTexture);
    const rep = themedTexture(theme, "floor", { repeat: [4, 2] });
    expect(rep).not.toBe(floor);
    expect(rep.source).toBe(floor.source);
    expect(rep.repeat.x).toBe(4);
    const m = themedMaterial(theme, "floor") as MeshStandardMaterial;
    expect(m.emissiveMap).toBe(floor.userData.emissiveMask);
  });

  it("pixel textures follow theme.texelsPerUnit when uvPerUnit is given", () => {
    const theme = { ...variant("pixel", "flat", "pixel"), texelsPerUnit: 32 };
    const base = themedTexture(theme, "wood");
    const t = themedTexture(theme, "wood", { uvPerUnit: 1.7 });
    expect(t.repeat.x).toBeCloseTo(32 / (base.image.width * 1.7), 5);
  });
});

describe("fonts", () => {
  it.each(ALL_IDS)("%s has a usable typeface", (id) => {
    const f = getThemeFont(THEMES[id]);
    expect(f.generateShapes("Grocer", 1).length).toBeGreaterThan(0);
    if (THEMES[id].font === "helvetiker") expect(f).toBe(getHelvetikerFont());
  });

  it("drawableTextFor drops / maps glyphs the font lacks", () => {
    const f = getHelvetikerFont();
    expect(drawableTextFor(f, "Crème 🍪")).toBe("Creme ");
  });
});

describe("ThemeProvider persistence", () => {
  const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
  let setTheme: (id: ThemeId) => void = () => {};

  function Probe() {
    const theme = useSceneTheme();
    const hydrated = useThemeHydrated();
    const set = useSetTheme();
    setTheme = set;
    return createElement(Text, null, `${theme.id}:${hydrated ? "ready" : "loading"}`);
  }

  beforeEach(() => {
    store.clear();
    __resetThemeSessionForTests();
    setActiveThemeId("cozy");
  });

  it("defaults to cozy and works without a provider", async () => {
    await render(createElement(Probe));
    expect(screen.getByText("cozy:ready")).toBeTruthy();
  });

  it("hydrates the saved theme, then persists changes", async () => {
    store.set(storageKeys.theme, "pixel");
    await render(createElement(ThemeProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByText("pixel:ready")).toBeTruthy());
    expect(getActiveTheme().id).toBe("pixel");

    await act(async () => setTheme("neon"));
    expect(screen.getByText("neon:ready")).toBeTruthy();
    expect(getActiveTheme().id).toBe("neon");
    await waitFor(() => expect(store.get(storageKeys.theme)).toBe("neon"));
  });

  it("ignores unknown saved values", async () => {
    store.set(storageKeys.theme, "vaporwave");
    await render(createElement(ThemeProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByText("cozy:ready")).toBeTruthy());
  });
});
