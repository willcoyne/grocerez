/* eslint-disable react/no-unknown-property -- R3F JSX props (args, attach, ...) are valid three.js props */
/**
 * Per-theme canvas state shared by the pantry and store canvases (web + native): clear colour, fog, renderer tone
 * mapping / exposure (re-applied on every theme change; three recompiles affected programs itself) and the theme's
 * full-screen effects (<ThemeEffects/> renders nothing for themes without effects, e.g. cozy).
 * Owner: theme integrator.
 */
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

import { themeCanvasProps } from "../../theme/canvas";
import { ThemeEffects } from "../../theme/ThemeEffects";
import type { SceneTheme } from "../../theme/types";

export type ThemeCanvasSetupProps = {
  theme: SceneTheme;
  /** overrides the theme's fog / exposure (the store is bigger and brighter) */
  fog?: { color: string; near: number; far: number } | null;
  background?: string;
  exposure?: number;
};

export function ThemeCanvasSetup({ theme, fog, background, exposure }: ThemeCanvasSetupProps) {
  const cp = themeCanvasProps(theme);
  const gl = useThree((s) => s.gl);
  const toneMapping = cp.toneMapping;
  const toneExposure = exposure ?? cp.toneMappingExposure;
  useEffect(() => {
    gl.toneMapping = toneMapping;
    gl.toneMappingExposure = toneExposure;
  }, [gl, toneMapping, toneExposure]);
  const f = fog === undefined ? cp.fog : fog;
  const bg = background ?? cp.background;
  return (
    <>
      <color attach="background" args={[bg]} />
      {f ? <fog key={`${f.color}|${f.near}|${f.far}`} attach="fog" args={[f.color, f.near, f.far]} /> : null}
      <ThemeEffects theme={theme} />
    </>
  );
}
