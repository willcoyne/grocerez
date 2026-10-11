/**
 * <ThemeEffects/>: full-screen post-processing for the active theme (pixelate, posterize, dither, outline, bloom,
 * vignette, grain). Put it anywhere inside the R3F <Canvas> (web or native). When the theme has no effects (cozy) it
 * renders nothing and R3F renders normally; otherwise it takes over rendering with useFrame(priority 1) and drives
 * ThemeEffectsPipeline (render targets + one composite shader). Remounts per theme.
 * Owner: theme core.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";

import { hasThemeEffects } from "./canvas";
import { ThemeEffectsPipeline } from "./effects/pipeline";
import { useSceneTheme } from "./ThemeProvider";
import type { SceneTheme } from "./types";

export type ThemeEffectsProps = {
  /** defaults to the active theme */
  theme?: SceneTheme;
  /** MSAA samples for the offscreen scene target; default 4 on web, 0 on expo-gl (ignored when pixelated) */
  msaa?: number;
  /** false = render normally (e.g. debugging); default true */
  enabled?: boolean;
};

export function ThemeEffects({ theme, msaa, enabled = true }: ThemeEffectsProps) {
  const active = useSceneTheme();
  const t = theme ?? active;
  if (!enabled || !hasThemeEffects(t)) return null;
  return <EffectsPass key={`${t.id}:${msaa ?? "auto"}`} theme={t} msaa={msaa} />;
}

function EffectsPass({ theme, msaa }: { theme: SceneTheme; msaa?: number }) {
  const gl = useThree((s) => s.gl);
  const pipeline = useMemo(() => new ThemeEffectsPipeline(gl, theme.effects, { msaa }), [gl, theme, msaa]);
  useEffect(() => () => pipeline.dispose(), [pipeline]);

  useFrame((state) => {
    pipeline.setSize(state.size.width, state.size.height, state.viewport.dpr);
    pipeline.render(state.scene, state.camera, state.clock.elapsedTime);
  }, 1);

  return null;
}
