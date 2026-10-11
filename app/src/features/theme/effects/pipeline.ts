/**
 * Render-target post-processing pipeline used by <ThemeEffects/> (no React, no DOM, no external libs).
 *
 * Frame: scene -> sceneRT (full drawing-buffer size, or CSS size / pixelSize with nearest filtering when pixelated;
 * + DepthTexture when outlines are on) -> [bloom: bright pass at 1/4 res, 2x separable blur] -> composite quad to the
 * screen (tone mapping + sRGB applied in the composite since three skips both for render targets).
 *
 * Native (expo-gl): R3F native wraps `gl.render` to call `endFrameEXP()` (present) after every call, so all
 * intermediate passes use the unwrapped prototype render and only the final composite goes through `gl.render`.
 * Fallbacks: half-float colour when EXT_color_buffer_(half_)float exists, else 8-bit sRGB targets; if a target is
 * incomplete with a depth texture, outlines are dropped; if it is still incomplete, effects switch off and the scene
 * renders directly.
 * Owner: theme core.
 */
import {
  Color,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type TextureDataType,
  type WebGLRenderer,
} from "three";

import { hexToRgb } from "../color";
import { inkSharedUniforms } from "../materials";
import type { ThemeEffects } from "../types";
import { BLUR_FRAG, BRIGHT_FRAG, COMPOSITE_FRAG, FULLSCREEN_VERT } from "./shaders";

export type PipelineOptions = {
  /** MSAA samples for the full-res scene target (ignored when pixelated). Default: 4 on web, 0 on expo-gl. */
  msaa?: number;
};

type Caps = { halfFloat: boolean; native: boolean };

function detectCaps(gl: WebGLRenderer): Caps {
  const ctx = gl.getContext() as WebGL2RenderingContext & { endFrameEXP?: () => void };
  let halfFloat = false;
  try {
    halfFloat = gl.extensions.has("EXT_color_buffer_float") || gl.extensions.has("EXT_color_buffer_half_float");
  } catch {
    halfFloat = false;
  }
  return { halfFloat, native: typeof ctx.endFrameEXP === "function" };
}

/** WebGLRenderer.prototype.render, bypassing R3F native's present-after-every-render wrapper. */
function rawRender(gl: WebGLRenderer, scene: Object3D, camera: Camera) {
  const proto = Object.getPrototypeOf(gl) as WebGLRenderer | null;
  const fn = proto && typeof proto.render === "function" ? proto.render : gl.render;
  fn.call(gl, scene, camera);
}

function displayColor(hex: string): Color {
  const [r, g, b] = hexToRgb(hex);
  // Composite works in output (display) space after tone mapping: no sRGB -> linear conversion.
  return new Color().setRGB(r / 255, g / 255, b / 255, NoColorSpace);
}

export class ThemeEffectsPipeline {
  readonly effects: ThemeEffects;
  /** true when the GPU couldn't run the pipeline; the scene is rendered directly */
  failed = false;
  /** outlines dropped because depth textures aren't renderable here */
  outlineDisabled = false;

  private gl: WebGLRenderer;
  private caps: Caps;
  private msaa: number;
  private colorType: TextureDataType;
  private sceneRT: WebGLRenderTarget | null = null;
  private bloomA: WebGLRenderTarget | null = null;
  private bloomB: WebGLRenderTarget | null = null;
  private quadScene = new Scene();
  private quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private composite: ShaderMaterial;
  private bright: ShaderMaterial | null = null;
  private blur: ShaderMaterial | null = null;
  private size = { w: 0, h: 0, rtW: 0, rtH: 0, dpr: 0 };
  private checked = false;
  private tmp = new Vector2();

  constructor(gl: WebGLRenderer, effects: ThemeEffects, opts: PipelineOptions = {}) {
    this.gl = gl;
    this.effects = effects;
    this.caps = detectCaps(gl);
    this.msaa = effects.pixelate ? 0 : (opts.msaa ?? (this.caps.native ? 0 : 4));
    this.colorType = this.caps.halfFloat ? HalfFloatType : UnsignedByteType;

    const e = effects;
    const defines: Record<string, string | number> = {};
    if (e.bloom) defines.USE_BLOOM = "";
    if (e.posterize || e.dither) defines.USE_POSTERIZE = "";
    if (e.outline) defines.USE_OUTLINE = "";
    if (e.vignette) defines.USE_VIGNETTE = "";
    if (e.grain) {
      defines.USE_GRAIN = "";
      defines.GRAIN_KIND = e.grain.kind === "paper" ? 0 : e.grain.kind === "scanline" ? 1 : 2;
    }
    this.composite = new ShaderMaterial({
      name: "ThemeEffectsComposite",
      defines,
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        tBloom: { value: null },
        uResolution: { value: new Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uTime: { value: 0 },
        uProjInv: { value: null },
        uBloomStrength: { value: e.bloom?.strength ?? 0 },
        uLevels: { value: e.posterize?.levels ?? 8 },
        uDither: { value: e.dither?.strength ?? 0 },
        uOutlineColor: { value: displayColor(e.outline?.color ?? "#000000") },
        uOutlineTexels: { value: 1 },
        uOutlineStrength: { value: e.outline?.strength ?? 1 },
        uVignette: { value: e.vignette?.strength ?? 0 },
        uGrain: { value: e.grain?.strength ?? 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: true, // defines toneMapping() for the composite; applied manually mid-shader
    });
    if (e.bloom) {
      this.bright = new ShaderMaterial({
        uniforms: { tInput: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: e.bloom.threshold } },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: BRIGHT_FRAG,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.blur = new ShaderMaterial({
        uniforms: { tInput: { value: null }, uDir: { value: new Vector2() } },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: BLUR_FRAG,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
    }
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  private makeTarget(w: number, h: number, nearest: boolean, depth: boolean, samples: number) {
    const rt = new WebGLRenderTarget(w, h, {
      type: this.colorType,
      format: RGBAFormat,
      magFilter: nearest ? NearestFilter : LinearFilter,
      minFilter: nearest ? NearestFilter : LinearFilter,
      generateMipmaps: false,
      depthBuffer: depth,
      stencilBuffer: false,
      samples,
    });
    // 8-bit fallback stores sRGB (hardware encode/decode) so dark gradients don't band.
    rt.texture.colorSpace = this.colorType === UnsignedByteType ? SRGBColorSpace : NoColorSpace;
    return rt;
  }

  private disposeTargets() {
    this.sceneRT?.depthTexture?.dispose();
    this.sceneRT?.dispose();
    this.bloomA?.dispose();
    this.bloomB?.dispose();
    this.sceneRT = this.bloomA = this.bloomB = null;
  }

  private buildTargets() {
    this.disposeTargets();
    const { rtW, rtH } = this.size;
    const e = this.effects;
    const rt = this.makeTarget(rtW, rtH, !!e.pixelate, true, this.msaa);
    if (e.outline && !this.outlineDisabled) {
      const dt = new DepthTexture(rtW, rtH, UnsignedIntType);
      rt.depthTexture = dt;
    }
    this.sceneRT = rt;
    if (e.bloom) {
      const div = e.pixelate ? 2 : 4;
      const bw = Math.max(1, Math.round(rtW / div));
      const bh = Math.max(1, Math.round(rtH / div));
      this.bloomA = this.makeTarget(bw, bh, false, false, 0);
      this.bloomB = this.makeTarget(bw, bh, false, false, 0);
    }
    this.checked = false;
  }

  /** Keep targets matched to the canvas (CSS size + device pixel ratio). Cheap when unchanged. */
  setSize(cssW: number, cssH: number, dpr: number) {
    const e = this.effects;
    this.gl.getDrawingBufferSize(this.tmp);
    const rtW = e.pixelate ? Math.max(1, Math.round(cssW / e.pixelate.pixelSize)) : Math.max(1, this.tmp.x);
    const rtH = e.pixelate ? Math.max(1, Math.round(cssH / e.pixelate.pixelSize)) : Math.max(1, this.tmp.y);
    const s = this.size;
    if (s.rtW === rtW && s.rtH === rtH && s.w === cssW && s.h === cssH && s.dpr === dpr && this.sceneRT) return;
    this.size = { w: cssW, h: cssH, rtW, rtH, dpr };
    this.buildTargets();
  }

  /** Allocate + verify the targets once; degrade instead of drawing black. */
  private verify(): boolean {
    if (this.checked) return !this.failed;
    this.checked = true;
    const ok = (rt: WebGLRenderTarget | null) => {
      if (!rt) return true;
      const ctx = this.gl.getContext();
      try {
        this.gl.setRenderTarget(rt);
        if (typeof ctx.checkFramebufferStatus !== "function") return true;
        return ctx.checkFramebufferStatus(ctx.FRAMEBUFFER) === ctx.FRAMEBUFFER_COMPLETE;
      } catch {
        return false;
      } finally {
        this.gl.setRenderTarget(null);
      }
    };
    if (!ok(this.sceneRT) && this.sceneRT?.depthTexture) {
      this.outlineDisabled = true;
      this.buildTargets();
      this.checked = true;
    }
    if (!ok(this.sceneRT) && this.colorType !== UnsignedByteType) {
      this.colorType = UnsignedByteType;
      this.buildTargets();
      this.checked = true;
    }
    if (!ok(this.sceneRT) || !ok(this.bloomA)) {
      this.failed = true;
      this.disposeTargets();
      return false;
    }
    return true;
  }

  private pass(material: ShaderMaterial, target: WebGLRenderTarget | null) {
    this.quad.material = material;
    this.gl.setRenderTarget(target);
    if (target) rawRender(this.gl, this.quadScene, this.quadCam);
    else this.gl.render(this.quadScene, this.quadCam); // final: presents on native
  }

  render(scene: Object3D, camera: Camera, time: number) {
    const gl = this.gl;
    if (this.failed || !this.sceneRT || !this.verify() || !this.sceneRT) {
      gl.setRenderTarget(null);
      gl.render(scene, camera);
      return;
    }
    const { w, rtW, rtH } = this.size;
    const e = this.effects;
    inkSharedUniforms.uInkPixelRatio.value = w > 0 ? rtW / w : 1;

    // 1. scene
    gl.setRenderTarget(this.sceneRT);
    rawRender(gl, scene, camera);

    // 2. bloom
    if (e.bloom && this.bright && this.blur && this.bloomA && this.bloomB) {
      this.bright.uniforms.tInput.value = this.sceneRT.texture;
      (this.bright.uniforms.uTexel.value as Vector2).set(1 / rtW, 1 / rtH);
      this.pass(this.bright, this.bloomA);
      const bw = this.bloomA.width;
      const bh = this.bloomA.height;
      for (let i = 0; i < 2; i++) {
        const spread = 1 + i;
        this.blur.uniforms.tInput.value = this.bloomA.texture;
        (this.blur.uniforms.uDir.value as Vector2).set(spread / bw, 0);
        this.pass(this.blur, this.bloomB);
        this.blur.uniforms.tInput.value = this.bloomB.texture;
        (this.blur.uniforms.uDir.value as Vector2).set(0, spread / bh);
        this.pass(this.blur, this.bloomA);
      }
    }

    // 3. composite to screen
    const u = this.composite.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tDepth.value = this.sceneRT.depthTexture ?? null;
    u.tBloom.value = this.bloomA?.texture ?? null;
    (u.uResolution.value as Vector2).set(rtW, rtH);
    u.uPixelRatio.value = gl.getPixelRatio();
    u.uTime.value = time;
    u.uProjInv.value = camera.projectionMatrixInverse;
    u.uOutlineTexels.value = e.pixelate
      ? 1
      : Math.max(1, ((e.outline?.thickness ?? 1) * gl.getPixelRatio()) / 2);
    if (this.outlineDisabled && this.composite.defines.USE_OUTLINE !== undefined) {
      delete this.composite.defines.USE_OUTLINE;
      this.composite.needsUpdate = true;
    }
    this.pass(this.composite, null);
  }

  dispose() {
    this.disposeTargets();
    this.composite.dispose();
    this.bright?.dispose();
    this.blur?.dispose();
    this.quad.geometry.dispose();
  }
}
