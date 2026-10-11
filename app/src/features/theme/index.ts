/**
 * Theme system public API (round 3). Deep imports also fine; RN-only code can import from "./ThemeProvider" to avoid
 * pulling in three / R3F.
 */
export type {
  MaterialStyle,
  SceneTheme,
  TextureStyle,
  ThemeEffects as ThemeEffectsConfig,
  ThemeId,
  ThemeLighting,
  ThemePalette,
  ThemeUi,
} from "./types";
export { DEFAULT_THEME_ID, THEMES, THEME_IDS, getTheme, isThemeId, listThemes } from "./registry";
export {
  ThemeProvider,
  applyTheme,
  getActiveTheme,
  getActiveThemeId,
  subscribeActiveTheme,
  useSceneTheme,
  useSetTheme,
  useThemeHydrated,
  useThemeId,
  useThemeUi,
} from "./ThemeProvider";
export {
  MATERIAL_ROLES,
  createThemedMaterial,
  defaultTextureFor,
  disposeThemeCaches,
  inkSharedUniforms,
  themedMaterial,
  toonGradient,
  type MaterialOverrides,
  type MaterialRole,
  type ThemedMaterial,
} from "./materials";
export { disposeThemeTextures, textureRepeat, themedTexture, type TextureKind, type ThemedTextureOptions } from "./textures";
export { ThemeEffects, type ThemeEffectsProps } from "./ThemeEffects";
export { ThemeEffectsPipeline } from "./effects/pipeline";
export { drawableTextFor, fontHasGlyph, getHelvetikerFont, getThemeFont, textAdvance } from "./fonts";
export { hasThemeEffects, themeCanvasProps, themeLights, type ThemeCanvasProps, type ThemeLightsData } from "./canvas";
export { contrastRatio, hexToRgb, isHexColor, mixHex, shadeHex } from "./color";
