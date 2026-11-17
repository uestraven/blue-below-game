/**
 * The period-correct renderer.
 *
 * Four things together produce the look, and each one can be dialled off per
 * material so that puzzle faces, signs and blood letters stay readable:
 *
 *  1. Screen-space vertex snapping - the hardware had no sub-pixel vertex
 *     precision, so geometry visibly wobbles as the camera moves.
 *  2. Affine texture mapping - no perspective correction, so textures swim
 *     across large surfaces. Achieved by interpolating uv*w and w and dividing
 *     in the fragment shader, which cancels the GPU's perspective correction.
 *  3. Gouraud-style lighting - a baked per-vertex term plus one per-fragment
 *     handlamp, no shadow maps.
 *  4. A 320x224-class internal buffer, ordered dithering and 5-bit colour,
 *     upscaled nearest-neighbour.
 */

import * as THREE from 'three';

export interface PsxMaterialOptions {
  map: THREE.Texture;
  /** 0 = razor sharp, 1 = full console wobble. */
  jitter?: number;
  /** 0 = perspective-correct, 1 = fully affine. */
  affine?: number;
  /** Multiplies the lighting term; used for dynamic objects. */
  tint?: THREE.Color;
  /** Adds the texture to itself; 1 makes a surface a light source. */
  emissive?: number;
  alphaTest?: number;
  transparent?: boolean;
  depthWrite?: boolean;
  side?: THREE.Side;
  /** Skips fog; used for the first-person weapon. */
  noFog?: boolean;
  blending?: THREE.Blending;
}

const VERT = /* glsl */ `
attribute vec3 color;

uniform vec2 uRes;
uniform float uJitter;

varying vec2 vUvW;
varying float vW;
varying vec2 vUvLin;
varying vec3 vLight;
varying vec3 vWorld;
varying vec3 vNormalW;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);

  vec4 clip = projectionMatrix * viewMatrix * world;

  // Snap to the low-resolution pixel grid in screen space. Only valid in front
  // of the near plane; behind it the divide blows up and the triangle is
  // clipped away anyway.
  if (clip.w > 0.02 && uJitter > 0.0) {
    vec2 halfRes = uRes * 0.5;
    vec2 ndc = clip.xy / clip.w;
    vec2 snapped = floor(ndc * halfRes + 0.5) / halfRes;
    clip.xy = mix(ndc, snapped, uJitter) * clip.w;
  }

  gl_Position = clip;

  // uv * w and w interpolate to screen-linear uv after the division below.
  vUvW = uv * clip.w;
  vW = clip.w;
  vUvLin = uv;
  vLight = color;
}
`;

const FRAG = /* glsl */ `
precision mediump float;

uniform sampler2D map;
uniform float uAffine;
uniform vec3 uTint;
uniform float uEmissive;
uniform float uAlphaTest;
uniform float uOpacity;

uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogEnabled;

uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
uniform vec3 uFlashColor;
uniform float uFlashRange;
uniform float uFlashInner;
uniform float uFlashOuter;

varying vec2 vUvW;
varying float vW;
varying vec2 vUvLin;
varying vec3 vLight;
varying vec3 vWorld;
varying vec3 vNormalW;

void main() {
  vec2 uvAffine = vUvW / max(vW, 0.0001);
  vec2 uv = mix(vUvLin, uvAffine, uAffine);

  vec4 tex = texture2D(map, uv);
  if (tex.a < uAlphaTest) discard;

  vec3 n = normalize(vNormalW);

  // One handlamp, evaluated per fragment so it still shapes large surfaces
  // that only have a vertex every metre and a half.
  vec3 toLight = uFlashPos - vWorld;
  float dist = length(toLight);
  vec3 l = toLight / max(dist, 0.0001);
  float ndl = max(dot(n, l), 0.0) * 0.82 + 0.18;
  float cone = smoothstep(uFlashOuter, uFlashInner, dot(-l, uFlashDir));
  float atten = 1.0 - clamp(dist / uFlashRange, 0.0, 1.0);
  atten *= atten;
  vec3 lamp = uFlashColor * (ndl * cone * atten);

  vec3 lit = tex.rgb * (vLight * uTint + lamp) + tex.rgb * uEmissive;

  float fogAmount = (1.0 - exp(-uFogDensity * max(vW, 0.0))) * uFogEnabled;
  lit = mix(lit, uFogColor, clamp(fogAmount, 0.0, 1.0));

  gl_FragColor = vec4(lit, tex.a * uOpacity);
}
`;

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const POST_FRAG = /* glsl */ `
precision mediump float;

uniform sampler2D tDiffuse;
uniform vec2 uLowRes;
uniform float uDither;
uniform float uLevels;
uniform float uVignette;
uniform float uScanline;
uniform float uFade;
uniform vec3 uFadeColor;

varying vec2 vUv;

float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

void main() {
  vec2 uv = vUv;
  vec3 c = texture2D(tDiffuse, uv).rgb;

  // Dither and quantise on the low-resolution pixel lattice so the pattern
  // stays chunky after the nearest-neighbour upscale.
  vec2 p = floor(uv * uLowRes);
  c += (bayer4(p) - 0.5) * uDither / uLevels;
  c = floor(c * uLevels + 0.5) / uLevels;

  c *= 1.0 - uScanline * step(1.0, mod(p.y, 2.0));

  vec2 d = uv - 0.5;
  c *= 1.0 - uVignette * clamp(dot(d, d) * 2.2, 0.0, 1.0);

  c = mix(c, uFadeColor, clamp(uFade, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

export class PsxRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly target: THREE.WebGLRenderTarget;

  /** Uniform holders shared by every world material. */
  readonly shared = {
    uRes: { value: new THREE.Vector2(320, 224) },
    uFogColor: { value: new THREE.Color(0x090b10) },
    uFogDensity: { value: 0.028 },
    uFlashPos: { value: new THREE.Vector3() },
    uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
    // The handlamp. Wide and soft: it is there so the player can read the
    // facility, not so they can floodlight it.
    uFlashColor: { value: new THREE.Color(0.66, 0.63, 0.57) },
    uFlashRange: { value: 19 },
    uFlashInner: { value: 0.78 },
    uFlashOuter: { value: 0.3 },
  };

  private postScene = new THREE.Scene();
  private postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMaterial: THREE.ShaderMaterial;

  /** Internal buffer height; width follows the viewport aspect. */
  baseHeight = 224;
  private cssW = 1;
  private cssH = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x05070b, 1);
    // Gamma-space pipeline end to end: no automatic linearisation on texture
    // reads and no encoding on output, so what the palette says is what the
    // screen gets.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.target = new THREE.WebGLRenderTarget(320, 224, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
      type: THREE.UnsignedByteType,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;

    this.postMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uLowRes: { value: new THREE.Vector2(320, 224) },
        uDither: { value: 1.0 },
        uLevels: { value: 31.0 },
        uVignette: { value: 0.3 },
        uScanline: { value: 0.07 },
        uFade: { value: 0 },
        uFadeColor: { value: new THREE.Color(0, 0, 0) },
      },
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setSize(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, Math.floor(cssW));
    this.cssH = Math.max(1, Math.floor(cssH));
    this.renderer.setSize(this.cssW, this.cssH, false);

    const aspect = this.cssW / this.cssH;
    const h = this.baseHeight;
    const w = Math.max(160, Math.min(512, Math.round((h * aspect) / 2) * 2));
    this.target.setSize(w, h);
    this.shared.uRes.value.set(w, h);
    (this.postMaterial.uniforms.uLowRes.value as THREE.Vector2).set(w, h);
  }

  get lowResWidth(): number {
    return this.target.width;
  }

  get lowResHeight(): number {
    return this.target.height;
  }

  /** Screen fade used by endings, deaths and transitions. */
  setFade(amount: number, color: THREE.ColorRepresentation = 0x000000): void {
    this.postMaterial.uniforms.uFade.value = amount;
    (this.postMaterial.uniforms.uFadeColor.value as THREE.Color).set(color);
  }

  beginFrame(): void {
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear(true, true, true);
  }

  renderScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
  }

  /** Draw the first-person weapon over the world without clipping into walls. */
  renderOverlay(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.setRenderTarget(this.target);
    this.renderer.clearDepth();
    this.renderer.render(scene, camera);
  }

  present(): void {
    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.postScene, this.postCamera);
  }

  createMaterial(opts: PsxMaterialOptions): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: opts.map },
        uJitter: { value: opts.jitter ?? 1 },
        uAffine: { value: opts.affine ?? 1 },
        uTint: { value: opts.tint ? opts.tint.clone() : new THREE.Color(1, 1, 1) },
        uEmissive: { value: opts.emissive ?? 0 },
        uAlphaTest: { value: opts.alphaTest ?? 0 },
        uOpacity: { value: 1 },
        uFogEnabled: { value: opts.noFog ? 0 : 1 },
        uRes: this.shared.uRes,
        uFogColor: this.shared.uFogColor,
        uFogDensity: this.shared.uFogDensity,
        uFlashPos: this.shared.uFlashPos,
        uFlashDir: this.shared.uFlashDir,
        uFlashColor: this.shared.uFlashColor,
        uFlashRange: this.shared.uFlashRange,
        uFlashInner: this.shared.uFlashInner,
        uFlashOuter: this.shared.uFlashOuter,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: opts.transparent ?? false,
      depthWrite: opts.depthWrite ?? true,
      side: opts.side ?? THREE.FrontSide,
      blending: opts.blending ?? THREE.NormalBlending,
    });
    return m;
  }

  dispose(): void {
    this.target.dispose();
    this.postMaterial.dispose();
    this.renderer.dispose();
  }
}
