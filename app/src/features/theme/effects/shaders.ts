/**
 * GLSL for <ThemeEffects/>: written GLSL1-style (three converts ShaderMaterial to GLSL ES 3.00 on WebGL2, which is
 * what expo-gl provides). One composite shader, features switched with defines.
 * Owner: theme core.
 */

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** Bright pass + 2x2 box downsample (linear HDR in, linear out). */
export const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = 0.25 * (
    texture2D( tInput, vUv + uTexel * vec2( -0.5, -0.5 ) ).rgb +
    texture2D( tInput, vUv + uTexel * vec2( 0.5, -0.5 ) ).rgb +
    texture2D( tInput, vUv + uTexel * vec2( -0.5, 0.5 ) ).rgb +
    texture2D( tInput, vUv + uTexel * vec2( 0.5, 0.5 ) ).rgb );
  float l = max( c.r, max( c.g, c.b ) );
  float knee = 0.5 * uThreshold + 1e-4;
  float soft = clamp( l - uThreshold + knee, 0.0, 2.0 * knee );
  soft = soft * soft / ( 4.0 * knee );
  float w = max( soft, l - uThreshold ) / max( l, 1e-4 );
  gl_FragColor = vec4( c * w, 1.0 );
}
`;

/** 9-tap gaussian in 5 bilinear fetches along uDir (in texels). */
export const BLUR_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  vec3 c = texture2D( tInput, vUv ).rgb * 0.2270270270;
  c += ( texture2D( tInput, vUv + o1 ).rgb + texture2D( tInput, vUv - o1 ).rgb ) * 0.3162162162;
  c += ( texture2D( tInput, vUv + o2 ).rgb + texture2D( tInput, vUv - o2 ).rgb ) * 0.0702702703;
  gl_FragColor = vec4( c, 1.0 );
}
`;

/**
 * Composite: scene (+ bloom) -> tone map -> output colour space -> posterize / dither -> outline -> vignette -> grain.
 * Defines: USE_BLOOM, USE_POSTERIZE, USE_OUTLINE, USE_VIGNETTE, USE_GRAIN, GRAIN_KIND (0 paper, 1 scanline, 2 noise).
 */
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2 uResolution;   // scene render-target size in texels (the pixel grid when pixelated)
uniform float uPixelRatio;  // output px per CSS px
uniform float uTime;
uniform mat4 uProjInv;
uniform float uBloomStrength;
uniform float uLevels;
uniform float uDither;
uniform vec3 uOutlineColor;
uniform float uOutlineTexels;
uniform float uOutlineStrength;
uniform float uVignette;
uniform float uGrain;
varying vec2 vUv;

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float valueNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash12( i );
  float b = hash12( i + vec2( 1.0, 0.0 ) );
  float c = hash12( i + vec2( 0.0, 1.0 ) );
  float d = hash12( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

// 4x4 Bayer matrix threshold in [0, 1)
float bayer4( vec2 p ) {
  vec2 q = mod( p, 4.0 );
  float x = q.x;
  float y = q.y;
  float b2a = mod( x, 2.0 ) * 2.0 + mod( y, 2.0 );
  float b2 = ( b2a == 0.0 ) ? 0.0 : ( b2a == 3.0 ) ? 1.0 : ( b2a == 2.0 ) ? 2.0 : 3.0;
  float hx = floor( x / 2.0 );
  float hy = floor( y / 2.0 );
  float h2a = hx * 2.0 + hy;
  float h2 = ( h2a == 0.0 ) ? 0.0 : ( h2a == 3.0 ) ? 1.0 : ( h2a == 2.0 ) ? 2.0 : 3.0;
  return ( 4.0 * b2 + h2 + 0.5 ) / 16.0;
}

#ifdef USE_OUTLINE
vec3 viewPos( vec2 uv ) {
  float d = texture2D( tDepth, uv ).x;
  vec4 p = uProjInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  return p.xyz / p.w;
}

// Plane-fit edge test on the depth buffer: estimate the surface normal from the neighbour on the side with the
// smaller depth jump, then measure how far each neighbour lies off that plane relative to its distance. Planes
// (even at grazing angles) give 0; creases give ~sin(angle); silhouettes give ~1. Scale-free, no thresholds in
// world units.
float depthEdge( vec2 uv, vec2 o ) {
  vec3 p0 = viewPos( uv );
  vec3 pl = viewPos( uv - vec2( o.x, 0.0 ) );
  vec3 pr = viewPos( uv + vec2( o.x, 0.0 ) );
  vec3 pd = viewPos( uv - vec2( 0.0, o.y ) );
  vec3 pu = viewPos( uv + vec2( 0.0, o.y ) );
  vec3 dx = abs( pr.z - p0.z ) < abs( p0.z - pl.z ) ? pr - p0 : p0 - pl;
  vec3 dy = abs( pu.z - p0.z ) < abs( p0.z - pd.z ) ? pu - p0 : p0 - pd;
  vec3 n = cross( dx, dy );
  float nl = length( n );
  if ( nl < 1e-12 ) return 0.0;
  n /= nl;
  float e = 0.0;
  vec3 v;
  v = pl - p0; e = max( e, abs( dot( v, n ) ) / max( length( v ), 1e-6 ) );
  v = pr - p0; e = max( e, abs( dot( v, n ) ) / max( length( v ), 1e-6 ) );
  v = pd - p0; e = max( e, abs( dot( v, n ) ) / max( length( v ), 1e-6 ) );
  v = pu - p0; e = max( e, abs( dot( v, n ) ) / max( length( v ), 1e-6 ) );
  return smoothstep( 0.22, 0.5, e );
}
#endif

void main() {
  vec3 c = texture2D( tScene, vUv ).rgb;

  #ifdef USE_BLOOM
    c += texture2D( tBloom, vUv ).rgb * uBloomStrength;
  #endif

  #ifdef TONE_MAPPING
    c = toneMapping( c );
  #endif
  c = linearToOutputTexel( vec4( c, 1.0 ) ).rgb;

  vec2 cell = floor( vUv * uResolution );

  #ifdef USE_POSTERIZE
    float L = max( uLevels - 1.0, 1.0 );
    float t = mix( 0.5, bayer4( cell ), uDither );
    c = floor( clamp( c, 0.0, 1.0 ) * L + t ) / L;
  #endif

  #ifdef USE_OUTLINE
    vec2 o = uOutlineTexels / uResolution;
    float e = depthEdge( ( cell + 0.5 ) / uResolution, o );
    c = mix( c, uOutlineColor, e * uOutlineStrength );
  #endif

  #ifdef USE_VIGNETTE
    vec2 q = vUv - 0.5;
    float vig = smoothstep( 0.9, 0.25, length( q ) * 1.15 );
    c *= mix( 1.0, vig, uVignette );
  #endif

  #ifdef USE_GRAIN
    vec2 g = gl_FragCoord.xy / max( uPixelRatio, 1e-3 );
    #if GRAIN_KIND == 0
      // paper: blotches + fibres, static (anchored to the screen like a sheet under the drawing)
      float pn = valueNoise( g * 0.035 ) * 0.55 + valueNoise( g * 0.12 ) * 0.3 + hash12( floor( g ) ) * 0.15;
      float fib = smoothstep( 0.92, 1.0, valueNoise( vec2( g.x * 0.6, g.y * 0.05 ) ) );
      c *= 1.0 - uGrain * ( 0.35 * pn + 0.25 * fib );
    #elif GRAIN_KIND == 1
      float sl = 0.5 + 0.5 * cos( g.y * 3.14159265 );
      c *= 1.0 - uGrain * sl;
    #else
      float n = hash12( floor( g ) + floor( uTime * 24.0 ) * 17.0 );
      c += ( n - 0.5 ) * uGrain;
    #endif
  #endif

  gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
}
`;
