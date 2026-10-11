/**
 * Theme material factory. `themedMaterial(theme, role, overrides?)` returns a SHARED material (cached per theme id +
 * role + overrides); `createThemedMaterial(...)` returns a fresh one the caller owns (per-item materials that get
 * mutated, e.g. food dim/glow). Shading follows theme.materialStyle:
 * - standard -> MeshStandardMaterial (cozy; role defaults copy the pre-theme scene values)
 * - toon     -> MeshToonMaterial + nearest stepped gradientMap (theme.toonSteps bands)
 * - flat     -> MeshLambertMaterial, flatShading, nearest pixel textures (pixel art)
 * - ink      -> MeshLambertMaterial whose shading is replaced by paper fill + world-anchored pen hatching that gets
 *              denser in shadow (outlines come from <ThemeEffects/>)
 * Every material has `.color`, `.emissive`, `.emissiveIntensity`, `.map`, `.opacity` (no MeshBasicMaterial), so
 * existing glow/dim code keeps working across themes. Unlit looks (ink text, flat LEDs) use black colour + emissive.
 * Owner: theme core.
 */
import {
  BackSide,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  MeshLambertMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  type Side,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";

import { disposeThemeTextures, themedTexture, type TextureKind, type ThemedTextureOptions } from "./textures";
import type { SceneTheme } from "./types";

export type MaterialRole =
  | "wood"
  | "woodDark"
  | "woodLight"
  | "wall"
  | "floor"
  | "floorAlt"
  | "trim"
  | "metal"
  | "knob"
  | "glass"
  | "paper"
  | "ink"
  | "plant"
  | "pot"
  | "fridgeWall"
  | "freezerWall"
  | "accent"
  | "allergen"
  | "highlight"
  | "emissive"
  | "generic";

export const MATERIAL_ROLES: readonly MaterialRole[] = [
  "wood",
  "woodDark",
  "woodLight",
  "wall",
  "floor",
  "floorAlt",
  "trim",
  "metal",
  "knob",
  "glass",
  "paper",
  "ink",
  "plant",
  "pot",
  "fridgeWall",
  "freezerWall",
  "accent",
  "allergen",
  "highlight",
  "emissive",
  "generic",
];

export type MaterialOverrides = {
  /** replaces the palette colour (the colour for "generic" and "emissive") */
  color?: string;
  /** texture: a kind forces one, false disables the role default */
  map?: TextureKind | false;
  /** repeat / uvPerUnit / variant passed to themedTexture */
  texture?: ThemedTextureOptions;
  /** geometry carries the colour (exterior): material colour becomes white unless `color` is given */
  vertexColors?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  depthWrite?: boolean;
  side?: "front" | "back" | "double";
  /** standard style only */
  roughness?: number;
  /** standard style only */
  metalness?: number;
  flatShading?: boolean;
  toneMapped?: boolean;
  fog?: boolean;
  /** ink style: set false to skip hatching (labels, small text backs) */
  hatch?: boolean;
  /** free-form tag to get a separate cached instance with otherwise equal settings */
  tag?: string;
};

export type ThemedMaterial = MeshStandardMaterial | MeshToonMaterial | MeshLambertMaterial;

// ---------------------------------------------------------------------------------------------------------------
// role defaults

type RoleSpec = {
  color: (t: SceneTheme) => string;
  roughness: number;
  metalness?: number;
  emissive?: (t: SceneTheme) => [string, number];
  glass?: boolean;
  side?: Side;
  flatShading?: boolean;
  /** rendered with constant colour (black + emissive) in flat / ink styles */
  unlit?: boolean;
  hatch?: boolean;
};

const ROLE: Record<MaterialRole, RoleSpec> = {
  wood: { color: (t) => t.palette.wood, roughness: 0.68 },
  woodDark: { color: (t) => t.palette.woodDark, roughness: 0.7 },
  woodLight: { color: (t) => t.palette.woodLight, roughness: 0.68 },
  wall: { color: (t) => t.palette.wall, roughness: 0.95 },
  floor: { color: (t) => t.palette.floor, roughness: 0.72 },
  floorAlt: { color: (t) => t.palette.floorAlt, roughness: 0.72 },
  trim: { color: (t) => t.palette.trim, roughness: 0.78 },
  metal: { color: (t) => t.palette.metal, roughness: 0.32, metalness: 0.75 },
  knob: {
    color: (t) => t.palette.knob ?? t.palette.metal,
    roughness: 0.32,
    metalness: 0.55,
    emissive: (t) => [t.palette.highlight, 0],
  },
  glass: { color: (t) => t.palette.glass, roughness: 0.05, metalness: 0.1, glass: true, hatch: false },
  paper: { color: (t) => t.palette.paper, roughness: 0.9, side: DoubleSide },
  ink: { color: (t) => t.palette.ink, roughness: 0.8, unlit: true, hatch: false },
  plant: { color: (t) => t.palette.plant, roughness: 0.6, flatShading: true },
  pot: { color: (t) => t.palette.pot, roughness: 0.78 },
  fridgeWall: { color: (t) => t.palette.fridgeWall, roughness: 0.55, emissive: (t) => [t.lighting.fridgeLight, 0.12] },
  freezerWall: { color: (t) => t.palette.freezerWall, roughness: 0.9, emissive: (t) => [t.lighting.freezerLight, 0.18] },
  accent: { color: (t) => t.palette.accent, roughness: 0.6 },
  allergen: { color: (t) => t.palette.allergen, roughness: 0.7, emissive: (t) => [t.palette.allergen, 0.3] },
  highlight: { color: (t) => t.palette.highlight, roughness: 0.6, emissive: (t) => [t.palette.highlight, 0.35] },
  emissive: { color: (t) => t.palette.accent, roughness: 0.5, unlit: true, hatch: false },
  generic: { color: () => "#FFFFFF", roughness: 0.7 },
};

/** Default texture per role for a TextureStyle (grain = cozy: wall and paper stay untextured like before). */
export function defaultTextureFor(theme: SceneTheme, role: MaterialRole): TextureKind | null {
  if (theme.textureStyle === "none") return null;
  switch (role) {
    case "wood":
    case "woodDark":
    case "woodLight":
      return "wood";
    case "floor":
    case "floorAlt":
      return "floor";
    case "freezerWall":
      return "frost";
    case "wall":
      return theme.textureStyle === "grain" ? null : "wall";
    case "paper":
      return theme.textureStyle === "grain" ? null : "paper";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// toon gradient (shared, tiny; never disposed)

const gradients = new Map<number, DataTexture>();

/** Nearest-filtered stepped ramp for MeshToonMaterial (`steps` bands, darkest band at 40%). */
export function toonGradient(steps = 3): DataTexture {
  const n = Math.max(2, Math.min(8, Math.round(steps)));
  const hit = gradients.get(n);
  if (hit) return hit;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round((0.4 + (0.6 * i) / (n - 1)) * 255);
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new DataTexture(data, n, 1, RGBAFormat, UnsignedByteType);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  gradients.set(n, tex);
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------
// ink hatching (onBeforeCompile on MeshLambertMaterial; constant code, per-material uniforms)

/** Shared by every ink material. <ThemeEffects/> keeps uInkPixelRatio = render-target px per CSS px. */
export const inkSharedUniforms = {
  uInkPixelRatio: { value: 1 },
};

/** Hatch line spacing / width in CSS px. */
const INK_SPACING_PX = 5;
const INK_WIDTH_PX = 1.1;

const INK_VERTEX_PARS = /* glsl */ `
varying vec3 vInkWorld;
`;

const INK_VERTEX = /* glsl */ `
#include <worldpos_vertex>
{
  vec4 inkW = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    inkW = batchingMatrix * inkW;
  #endif
  #ifdef USE_INSTANCING
    inkW = instanceMatrix * inkW;
  #endif
  vInkWorld = ( modelMatrix * inkW ).xyz;
}
`;

const INK_FRAGMENT_PARS = /* glsl */ `
varying vec3 vInkWorld;
uniform vec3 uInkColor;
uniform float uInkStrength;
uniform float uInkPixelRatio;
uniform float uInkSpacing;
uniform float uInkWidth;

// distance-to-line in cycles -> antialiased coverage for a line widthPx wide (w = cycles per pixel)
float inkLine( float t, float w, float widthPx ) {
  float d = abs( fract( t + 0.5 ) - 0.5 );
  float hw = 0.5 * widthPx * w;
  return 1.0 - smoothstep( hw - 0.5 * w, hw + 0.5 * w, d );
}

// World-anchored parallel lines with ~constant on-screen spacing: two octaves blended so new lines fade in
// between existing ones as you zoom (no swimming, no popping).
float inkHatchLayer( vec2 p, vec2 dir, float spacingPx, float widthPx ) {
  float t = dot( p, dir );
  float w = max( fwidth( t ), 1e-6 );
  float lf = log2( 1.0 / ( spacingPx * w ) );
  float f0 = exp2( floor( lf ) );
  float fade = fract( lf );
  float a = inkLine( t * f0, w * f0, widthPx );
  float b = inkLine( t * f0 * 2.0, w * f0 * 2.0, widthPx );
  return max( a, b * fade ) * step( 0.02, widthPx );
}
`;

const INK_FRAGMENT = /* glsl */ `
{
  vec3 inkN = normalize( inverseTransformDirection( normal, viewMatrix ) );
  vec3 inkA = abs( inkN );
  vec2 inkP = ( inkA.x > inkA.y && inkA.x > inkA.z ) ? vInkWorld.zy : ( ( inkA.y > inkA.z ) ? vInkWorld.xz : vInkWorld.xy );
  vec3 inkLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  float inkAlb = max( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ), 0.04 );
  float inkL = dot( inkLit, vec3( 0.299, 0.587, 0.114 ) ) / inkAlb;
  float inkS = uInkSpacing * uInkPixelRatio;
  float inkWd = uInkWidth * uInkPixelRatio;
  float h1 = inkHatchLayer( inkP, vec2( 0.70710678, 0.70710678 ), inkS, inkWd * smoothstep( 0.95, 0.6, inkL ) );
  float h2 = inkHatchLayer( inkP, vec2( 0.70710678, -0.70710678 ), inkS, inkWd * smoothstep( 0.6, 0.35, inkL ) );
  float h3 = inkHatchLayer( inkP, vec2( 1.0, 0.0 ), inkS * 0.75, inkWd * smoothstep( 0.35, 0.12, inkL ) );
  float inkH = clamp( max( h1, max( h2, h3 ) ) * uInkStrength, 0.0, 1.0 );
  vec3 inkBase = diffuseColor.rgb * mix( 0.9, 1.0, smoothstep( 0.2, 0.9, inkL ) ) + totalEmissiveRadiance;
  outgoingLight = mix( inkBase, uInkColor, inkH );
}
#include <opaque_fragment>
`;

function makeInk(m: MeshLambertMaterial, inkColor: string, strength: number) {
  const uniforms = {
    uInkColor: { value: new Color(inkColor) },
    uInkStrength: { value: strength },
    uInkSpacing: { value: INK_SPACING_PX },
    uInkWidth: { value: INK_WIDTH_PX },
    uInkPixelRatio: inkSharedUniforms.uInkPixelRatio,
  };
  m.userData.ink = uniforms;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${INK_VERTEX_PARS}`)
      .replace("#include <worldpos_vertex>", INK_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${INK_FRAGMENT_PARS}`)
      .replace("#include <opaque_fragment>", INK_FRAGMENT);
  };
  // Injected code is constant, so every ink material can share one program.
  m.customProgramCacheKey = () => "theme-ink-v1";
}

// ---------------------------------------------------------------------------------------------------------------

const SIDES = { front: FrontSide, back: BackSide, double: DoubleSide } as const;

function build(theme: SceneTheme, role: MaterialRole, o: MaterialOverrides): ThemedMaterial {
  const spec = ROLE[role];
  const style = theme.materialStyle;

  const kind = o.map === false ? null : (o.map ?? defaultTextureFor(theme, role));
  const map: Texture | null = kind ? themedTexture(theme, kind, o.texture) : null;
  const baked = !!map?.userData.baked;
  const emissiveMask = (map?.userData.emissiveMask as Texture | undefined) ?? null;

  const baseColor = o.color ?? (o.vertexColors || baked ? "#FFFFFF" : spec.color(theme));
  const [emColor, emIntensity] = o.emissive
    ? [o.emissive, o.emissiveIntensity ?? 1]
    : emissiveMask
      ? [theme.palette.floorAlt, o.emissiveIntensity ?? 1]
      : spec.emissive
        ? [spec.emissive(theme)[0], o.emissiveIntensity ?? spec.emissive(theme)[1]]
        : ["#000000", o.emissiveIntensity ?? 1];

  const glass = !!spec.glass;
  const opacity = o.opacity ?? (glass ? 0.28 : 1);
  const transparent = o.transparent ?? opacity < 1;
  const common = {
    color: baseColor,
    map,
    emissive: emColor,
    emissiveIntensity: emIntensity,
    emissiveMap: emissiveMask,
    vertexColors: !!o.vertexColors,
    opacity,
    transparent,
    depthWrite: o.depthWrite ?? !transparent,
    side: o.side ? SIDES[o.side] : (spec.side ?? FrontSide),
    toneMapped: o.toneMapped ?? true,
    fog: o.fog ?? true,
  };

  // "emissive" role: the colour IS the glow
  const glowColor = o.color ?? spec.color(theme);
  let m: ThemedMaterial;
  switch (style) {
    case "toon": {
      m = new MeshToonMaterial({ ...common, gradientMap: toonGradient(theme.toonSteps ?? 3) });
      if (role === "metal" || role === "knob") m.color.offsetHSL(0, -0.05, 0.08);
      if (role === "emissive") {
        m.emissive.set(glowColor);
        m.emissiveIntensity = o.emissiveIntensity ?? 1;
      }
      break;
    }
    case "flat":
    case "ink": {
      const lam = new MeshLambertMaterial({ ...common, flatShading: o.flatShading ?? (style === "flat" ? !glass : !!spec.flatShading) });
      if (spec.unlit) {
        lam.emissive.set(glowColor);
        lam.emissiveIntensity = o.emissiveIntensity ?? 1;
        lam.color.set("#000000");
      }
      if (style === "ink" && (o.hatch ?? spec.hatch ?? true) && !spec.unlit) {
        makeInk(lam, theme.palette.ink, glass ? 0 : 1);
      }
      m = lam;
      break;
    }
    case "standard":
    default: {
      m = new MeshStandardMaterial({
        ...common,
        roughness: o.roughness ?? spec.roughness,
        metalness: o.metalness ?? spec.metalness ?? 0,
        flatShading: o.flatShading ?? !!spec.flatShading,
      });
      if (role === "emissive") {
        m.emissive.set(glowColor);
        m.emissiveIntensity = o.emissiveIntensity ?? 1.4;
      }
      break;
    }
  }
  m.name = `${theme.id}:${role}`;
  m.userData.themeId = theme.id;
  m.userData.themeRole = role;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// cache

const cache = new Map<string, Map<string, ThemedMaterial>>();

function stableKey(o: MaterialOverrides): string {
  const keys = Object.keys(o).sort() as (keyof MaterialOverrides)[];
  return keys
    .filter((k) => o[k] !== undefined)
    .map((k) => `${k}=${JSON.stringify(o[k])}`)
    .join(";");
}

/**
 * Shared, cached material for (theme, role, overrides). Don't dispose it; mutations are visible to every user of the
 * same key (same as the old module singletons). Use `createThemedMaterial` for per-object materials.
 */
export function themedMaterial(theme: SceneTheme, role: MaterialRole, overrides: MaterialOverrides = {}): ThemedMaterial {
  const key = `${role}|${stableKey(overrides)}`;
  let b = cache.get(theme.id);
  if (!b) {
    b = new Map();
    cache.set(theme.id, b);
  }
  const hit = b.get(key);
  if (hit) return hit;
  const m = build(theme, role, overrides);
  b.set(key, m);
  return m;
}

/** A fresh material the caller owns (dispose it). Textures stay shared/cached. */
export function createThemedMaterial(theme: SceneTheme, role: MaterialRole, overrides: MaterialOverrides = {}): ThemedMaterial {
  return build(theme, role, overrides);
}

/** Dispose every cached material and texture of `themeId` (e.g. after switching away from it). */
export function disposeThemeCaches(themeId: string): void {
  const b = cache.get(themeId);
  if (b) for (const m of b.values()) m.dispose();
  cache.delete(themeId);
  disposeThemeTextures(themeId);
}

/** Test / debug: number of cached materials for a theme. */
export function cachedMaterialCount(themeId: string): number {
  return cache.get(themeId)?.size ?? 0;
}
