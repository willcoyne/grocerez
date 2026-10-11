/**
 * Plain data the canvas / lights need per theme (integration consumes these; no React here).
 * Cozy values reproduce PantryCanvas.tsx / Lights.tsx / ShelfColumn ApplianceLights exactly.
 * Owner: theme core.
 */
import { ACESFilmicToneMapping, NeutralToneMapping, NoToneMapping, PCFShadowMap, type ToneMapping } from "three";

import type { SceneTheme } from "./types";

export type ThemeCanvasProps = {
  /** clear colour: `<color attach="background" args={[background]} />` and the RN view behind the canvas */
  background: string;
  /** `<fog attach="fog" args={[fog.color, fog.near, fog.far]} />`, or none */
  fog: { color: string; near: number; far: number } | null;
  /** apply in onCreated / an effect: gl.toneMapping = toneMapping */
  toneMapping: ToneMapping;
  toneMappingExposure: number;
  /** Canvas `shadows` prop */
  shadows: { enabled: boolean; type: typeof PCFShadowMap };
  /** whether <ThemeEffects/> will take over rendering (it renders nothing otherwise) */
  hasEffects: boolean;
};

const TONE: Record<SceneTheme["toneMapping"], ToneMapping> = {
  aces: ACESFilmicToneMapping,
  neutral: NeutralToneMapping,
  none: NoToneMapping,
};

export function hasThemeEffects(theme: SceneTheme): boolean {
  return Object.values(theme.effects).some((v) => v != null);
}

export function themeCanvasProps(theme: SceneTheme): ThemeCanvasProps {
  return {
    background: theme.background,
    fog: theme.fog,
    toneMapping: TONE[theme.toneMapping],
    toneMappingExposure: 1.05,
    shadows: { enabled: theme.lighting.shadows, type: PCFShadowMap },
    hasEffects: hasThemeEffects(theme),
  };
}

export type ThemeLightsData = {
  hemisphere: { sky: string; ground: string; intensity: number };
  ambient: { color: string; intensity: number };
  /** the only shadow caster (offset/shadow camera stay in Lights.tsx) */
  key: { color: string; intensity: number; castShadow: boolean };
  fill: { color: string; intensity: number };
  /** shelves ApplianceLights point lights */
  fridge: { color: string; intensity: number };
  freezer: { color: string; intensity: number };
};

export function themeLights(theme: SceneTheme): ThemeLightsData {
  const l = theme.lighting;
  return {
    hemisphere: { sky: l.hemiSky, ground: l.hemiGround, intensity: l.hemiIntensity },
    ambient: { color: l.ambientColor ?? l.fillColor, intensity: l.ambientIntensity ?? 0.18 },
    key: { color: l.keyColor, intensity: l.keyIntensity, castShadow: l.shadows },
    fill: { color: l.fillColor, intensity: l.fillIntensity },
    fridge: { color: l.fridgeLight, intensity: 1.8 },
    freezer: { color: l.freezerLight, intensity: 1.6 },
  };
}
