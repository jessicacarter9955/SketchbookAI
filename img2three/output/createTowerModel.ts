import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Twisting Glass Skyscraper
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createTwistingGlassSkyscraperModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Twisting Glass Skyscraper";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 35, "aspect": 1, "orientation": {"yaw": -18, "pitch": 8, "roll": 0}, "positionHint": [4, 1.7, 14], "note": "Reference appears to be a 3/4 low angle view; camera fit provisional"}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["reflective-glass"] = createSculptMaterial(
    "reflective-glass",
    {"id": "reflective-glass", "name": "reflective-glass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#8CACC2", "color": "#8CACC2", "albedo": {"dominant": "#8CACC2", "secondary": ["#8CACC2", "#8CACC2"], "samplingNotes": "Use image-observed local color zones, not a single averaged color."}, "colorVariation": {"palette": ["#8CACC2", "#8CACC2"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.12, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.22, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.4, "notes": "Independent contact shadows, architectural pane gaps and bevels"}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "reflective-glass-local-shading", "region": "facade-left-glint", "color": "#8CACC2", "roughness": 0.13999999999999999, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Glass uses Three.js physical/transmission or glossy metallic look as provisional approximation", "Primary micro detail is explicit mullion geometry not random noise"], "notes": "Material appearance from photograph; true independent reference-PBR channels not yet calibrated", "qualityTier": "hero"},
    options
  );
  materialMap["curtain-wall-metal"] = createSculptMaterial(
    "curtain-wall-metal",
    {"id": "curtain-wall-metal", "name": "curtain-wall-metal", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#344657", "color": "#344657", "albedo": {"dominant": "#344657", "secondary": ["#344657", "#344657"], "samplingNotes": "Use image-observed local color zones, not a single averaged color."}, "colorVariation": {"palette": ["#344657", "#344657"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.28, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.82, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.4, "notes": "Independent contact shadows, architectural pane gaps and bevels"}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "curtain-wall-metal-local-shading", "region": "facade-left-glint", "color": "#344657", "roughness": 0.30000000000000004, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Glass uses Three.js physical/transmission or glossy metallic look as provisional approximation", "Primary micro detail is explicit mullion geometry not random noise"], "notes": "Material appearance from photograph; true independent reference-PBR channels not yet calibrated", "qualityTier": "hero"},
    options
  );
  materialMap["base-stone"] = createSculptMaterial(
    "base-stone",
    {"id": "base-stone", "name": "base-stone", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#9D9F9A", "color": "#9D9F9A", "albedo": {"dominant": "#9D9F9A", "secondary": ["#9D9F9A", "#9D9F9A"], "samplingNotes": "Use image-observed local color zones, not a single averaged color."}, "colorVariation": {"palette": ["#9D9F9A", "#9D9F9A"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.76, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.08, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.4, "notes": "Independent contact shadows, architectural pane gaps and bevels"}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "base-stone-local-shading", "region": "facade-left-glint", "color": "#9D9F9A", "roughness": 0.78, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Glass uses Three.js physical/transmission or glossy metallic look as provisional approximation", "Primary micro detail is explicit mullion geometry not random noise"], "notes": "Material appearance from photograph; true independent reference-PBR channels not yet calibrated", "qualityTier": "hero"},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Structural base plinth__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, -4.95, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Structural base plinth", "level": "macro", "role": "body", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Short rectangular foundation under the tower", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1.25, "height": 0.18, "depth": 0.95, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -4.95, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.25, 0.18, 0.95], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "base-stone", "materialLayers": ["base-stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "base-step", "kind": "seam", "notes": "stepped edge of podium"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(155, 154, 150, 1.0)", "secondaryAlbedo": "rgba(155, 154, 150, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.25, 0.18, 0.95], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["base-stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Structural base plinth";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Structural base plinth", "level": "macro", "role": "body", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Short rectangular foundation under the tower", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1.25, "height": 0.18, "depth": 0.95, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -4.95, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.25, 0.18, 0.95], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "base-stone", "materialLayers": ["base-stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "base-step", "kind": "seam", "notes": "stepped edge of podium"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(155, 154, 150, 1.0)", "secondaryAlbedo": "rgba(155, 154, 150, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.25, 0.18, 0.95], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_tier_0_1 = makeAttachmentEndpoint(null);
  const node_tier_0_1 = new THREE.Group();
  node_tier_0_1.name = "Glass curtainwall tower tier 1__pivot";
  node_tier_0_1.scale.set(1, 1, 1);
  if (endpoint_tier_0_1) {
    node_tier_0_1.position.copy(endpoint_tier_0_1.start);
    node_tier_0_1.rotation.set(0.0, -0.25, 0.0);
  } else {
    node_tier_0_1.position.set(0.0, -4.55, 0.0);
    node_tier_0_1.rotation.set(0.0, -0.25, 0.0);
  }
  node_tier_0_1.userData.sculptComponent = {"id": "tier-0", "name": "Glass curtainwall tower tier 1", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.3034000000000001, "height": 0.8, "depth": 0.83, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, -4.55, 0], "rotation": [0, -0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.3034000000000001, 0.8, 0.83], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-0", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_0_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.3034000000000001, 0.8, 0.83], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_0_1);
  nodes["tier-0"] = node_tier_0_1;
  const mesh_tier_0_1Geometry = endpoint_tier_0_1
    ? new THREE.CylinderGeometry(endpoint_tier_0_1.endRadius, endpoint_tier_0_1.baseRadius, endpoint_tier_0_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_0_1) {
    mesh_tier_0_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_0_1 = new THREE.Mesh(
    mesh_tier_0_1Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_0_1.name = "Glass curtainwall tower tier 1";
  if (endpoint_tier_0_1) {
    mesh_tier_0_1.position.copy(endpoint_tier_0_1.midpoint);
    mesh_tier_0_1.quaternion.copy(endpoint_tier_0_1.quaternion);
  }
  mesh_tier_0_1.castShadow = options.castShadow ?? true;
  mesh_tier_0_1.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_0_1.userData.sculptComponent = {"id": "tier-0", "name": "Glass curtainwall tower tier 1", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.3034000000000001, "height": 0.8, "depth": 0.83, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, -4.55, 0], "rotation": [0, -0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.3034000000000001, 0.8, 0.83], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-0", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_0_1.add(mesh_tier_0_1);
  meshes["tier-0"] = mesh_tier_0_1;
  colliders["tier-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.3034000000000001, 0.8, 0.83], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-0"] ??= [];
  destructionGroups["tier-0"].push(node_tier_0_1);

  const endpoint_floor_ring_0_2 = makeAttachmentEndpoint(null);
  const node_floor_ring_0_2 = new THREE.Group();
  node_floor_ring_0_2.name = "Floor slab glint 1__pivot";
  node_floor_ring_0_2.scale.set(1, 1, 1);
  if (endpoint_floor_ring_0_2) {
    node_floor_ring_0_2.position.copy(endpoint_floor_ring_0_2.start);
    node_floor_ring_0_2.rotation.set(0.0, -0.25, 0.0);
  } else {
    node_floor_ring_0_2.position.set(0.0, -4.945, 0.0);
    node_floor_ring_0_2.rotation.set(0.0, -0.25, 0.0);
  }
  node_floor_ring_0_2.userData.sculptComponent = {"id": "floor-ring-0", "name": "Floor slab glint 1", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.33, "height": 0.035, "depth": 0.835, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, -4.945, 0], "rotation": [0, -0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.33, 0.035, 0.835], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-0", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_0_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.33, 0.035, 0.835], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_0_2);
  nodes["floor-ring-0"] = node_floor_ring_0_2;
  const mesh_floor_ring_0_2Geometry = endpoint_floor_ring_0_2
    ? new THREE.CylinderGeometry(endpoint_floor_ring_0_2.endRadius, endpoint_floor_ring_0_2.baseRadius, endpoint_floor_ring_0_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_0_2) {
    mesh_floor_ring_0_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_0_2 = new THREE.Mesh(
    mesh_floor_ring_0_2Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_0_2.name = "Floor slab glint 1";
  if (endpoint_floor_ring_0_2) {
    mesh_floor_ring_0_2.position.copy(endpoint_floor_ring_0_2.midpoint);
    mesh_floor_ring_0_2.quaternion.copy(endpoint_floor_ring_0_2.quaternion);
  }
  mesh_floor_ring_0_2.castShadow = options.castShadow ?? true;
  mesh_floor_ring_0_2.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_0_2.userData.sculptComponent = {"id": "floor-ring-0", "name": "Floor slab glint 1", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.33, "height": 0.035, "depth": 0.835, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, -4.945, 0], "rotation": [0, -0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.33, 0.035, 0.835], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-0", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_0_2.add(mesh_floor_ring_0_2);
  meshes["floor-ring-0"] = mesh_floor_ring_0_2;
  colliders["floor-ring-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.33, 0.035, 0.835], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-0"] ??= [];
  destructionGroups["floor-ring-0"].push(node_floor_ring_0_2);

  const endpoint_tier_1_3 = makeAttachmentEndpoint(null);
  const node_tier_1_3 = new THREE.Group();
  node_tier_1_3.name = "Glass curtainwall tower tier 2__pivot";
  node_tier_1_3.scale.set(1, 1, 1);
  if (endpoint_tier_1_3) {
    node_tier_1_3.position.copy(endpoint_tier_1_3.start);
    node_tier_1_3.rotation.set(0.0, -0.20454545454545453, 0.0);
  } else {
    node_tier_1_3.position.set(0.005910404133226791, -3.76, 0.0);
    node_tier_1_3.rotation.set(0.0, -0.20454545454545453, 0.0);
  }
  node_tier_1_3.userData.sculptComponent = {"id": "tier-1", "name": "Glass curtainwall tower tier 2", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.2457408903886442, "height": 0.8, "depth": 0.7998732292933436, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.005910404133226791, -3.76, 0], "rotation": [0, -0.20454545454545453, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2457408903886442, 0.8, 0.7998732292933436], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-1", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_1_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2457408903886442, 0.8, 0.7998732292933436], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_1_3);
  nodes["tier-1"] = node_tier_1_3;
  const mesh_tier_1_3Geometry = endpoint_tier_1_3
    ? new THREE.CylinderGeometry(endpoint_tier_1_3.endRadius, endpoint_tier_1_3.baseRadius, endpoint_tier_1_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_1_3) {
    mesh_tier_1_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_1_3 = new THREE.Mesh(
    mesh_tier_1_3Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_1_3.name = "Glass curtainwall tower tier 2";
  if (endpoint_tier_1_3) {
    mesh_tier_1_3.position.copy(endpoint_tier_1_3.midpoint);
    mesh_tier_1_3.quaternion.copy(endpoint_tier_1_3.quaternion);
  }
  mesh_tier_1_3.castShadow = options.castShadow ?? true;
  mesh_tier_1_3.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_1_3.userData.sculptComponent = {"id": "tier-1", "name": "Glass curtainwall tower tier 2", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.2457408903886442, "height": 0.8, "depth": 0.7998732292933436, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.005910404133226791, -3.76, 0], "rotation": [0, -0.20454545454545453, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2457408903886442, 0.8, 0.7998732292933436], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-1", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_1_3.add(mesh_tier_1_3);
  meshes["tier-1"] = mesh_tier_1_3;
  colliders["tier-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.2457408903886442, 0.8, 0.7998732292933436], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-1"] ??= [];
  destructionGroups["tier-1"].push(node_tier_1_3);

  const endpoint_floor_ring_1_4 = makeAttachmentEndpoint(null);
  const node_floor_ring_1_4 = new THREE.Group();
  node_floor_ring_1_4.name = "Floor slab glint 2__pivot";
  node_floor_ring_1_4.scale.set(1, 1, 1);
  if (endpoint_floor_ring_1_4) {
    node_floor_ring_1_4.position.copy(endpoint_floor_ring_1_4.start);
    node_floor_ring_1_4.rotation.set(0.0, -0.20454545454545453, 0.0);
  } else {
    node_floor_ring_1_4.position.set(0.005910404133226791, -4.154999999999999, 0.0);
    node_floor_ring_1_4.rotation.set(0.0, -0.20454545454545453, 0.0);
  }
  node_floor_ring_1_4.userData.sculptComponent = {"id": "floor-ring-1", "name": "Floor slab glint 2", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.2711641738659636, "height": 0.035, "depth": 0.8048732292933436, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.005910404133226791, -4.154999999999999, 0], "rotation": [0, -0.20454545454545453, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2711641738659636, 0.035, 0.8048732292933436], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-1", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_1_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2711641738659636, 0.035, 0.8048732292933436], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_1_4);
  nodes["floor-ring-1"] = node_floor_ring_1_4;
  const mesh_floor_ring_1_4Geometry = endpoint_floor_ring_1_4
    ? new THREE.CylinderGeometry(endpoint_floor_ring_1_4.endRadius, endpoint_floor_ring_1_4.baseRadius, endpoint_floor_ring_1_4.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_1_4) {
    mesh_floor_ring_1_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_1_4 = new THREE.Mesh(
    mesh_floor_ring_1_4Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_1_4.name = "Floor slab glint 2";
  if (endpoint_floor_ring_1_4) {
    mesh_floor_ring_1_4.position.copy(endpoint_floor_ring_1_4.midpoint);
    mesh_floor_ring_1_4.quaternion.copy(endpoint_floor_ring_1_4.quaternion);
  }
  mesh_floor_ring_1_4.castShadow = options.castShadow ?? true;
  mesh_floor_ring_1_4.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_1_4.userData.sculptComponent = {"id": "floor-ring-1", "name": "Floor slab glint 2", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.2711641738659636, "height": 0.035, "depth": 0.8048732292933436, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.005910404133226791, -4.154999999999999, 0], "rotation": [0, -0.20454545454545453, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2711641738659636, 0.035, 0.8048732292933436], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-1", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_1_4.add(mesh_floor_ring_1_4);
  meshes["floor-ring-1"] = mesh_floor_ring_1_4;
  colliders["floor-ring-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.2711641738659636, 0.035, 0.8048732292933436], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-1"] ??= [];
  destructionGroups["floor-ring-1"].push(node_floor_ring_1_4);

  const endpoint_tier_2_5 = makeAttachmentEndpoint(null);
  const node_tier_2_5 = new THREE.Group();
  node_tier_2_5.name = "Glass curtainwall tower tier 3__pivot";
  node_tier_2_5.scale.set(1, 1, 1);
  if (endpoint_tier_2_5) {
    node_tier_2_5.position.copy(endpoint_tier_2_5.start);
    node_tier_2_5.rotation.set(0.0, -0.1590909090909091, 0.0);
  } else {
    node_tier_2_5.position.set(0.011292849467900708, -2.9699999999999998, 0.0);
    node_tier_2_5.rotation.set(0.0, -0.1590909090909091, 0.0);
  }
  node_tier_2_5.userData.sculptComponent = {"id": "tier-2", "name": "Glass curtainwall tower tier 3", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1923691118061837, "height": 0.8, "depth": 0.7720892250928505, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.011292849467900708, -2.9699999999999998, 0], "rotation": [0, -0.1590909090909091, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1923691118061837, 0.8, 0.7720892250928505], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-2", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_2_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1923691118061837, 0.8, 0.7720892250928505], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_2_5);
  nodes["tier-2"] = node_tier_2_5;
  const mesh_tier_2_5Geometry = endpoint_tier_2_5
    ? new THREE.CylinderGeometry(endpoint_tier_2_5.endRadius, endpoint_tier_2_5.baseRadius, endpoint_tier_2_5.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_2_5) {
    mesh_tier_2_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_2_5 = new THREE.Mesh(
    mesh_tier_2_5Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_2_5.name = "Glass curtainwall tower tier 3";
  if (endpoint_tier_2_5) {
    mesh_tier_2_5.position.copy(endpoint_tier_2_5.midpoint);
    mesh_tier_2_5.quaternion.copy(endpoint_tier_2_5.quaternion);
  }
  mesh_tier_2_5.castShadow = options.castShadow ?? true;
  mesh_tier_2_5.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_2_5.userData.sculptComponent = {"id": "tier-2", "name": "Glass curtainwall tower tier 3", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1923691118061837, "height": 0.8, "depth": 0.7720892250928505, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.011292849467900708, -2.9699999999999998, 0], "rotation": [0, -0.1590909090909091, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1923691118061837, 0.8, 0.7720892250928505], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-2", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_2_5.add(mesh_tier_2_5);
  meshes["tier-2"] = mesh_tier_2_5;
  colliders["tier-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.1923691118061837, 0.8, 0.7720892250928505], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-2"] ??= [];
  destructionGroups["tier-2"].push(node_tier_2_5);

  const endpoint_floor_ring_2_6 = makeAttachmentEndpoint(null);
  const node_floor_ring_2_6 = new THREE.Group();
  node_floor_ring_2_6.name = "Floor slab glint 3__pivot";
  node_floor_ring_2_6.scale.set(1, 1, 1);
  if (endpoint_floor_ring_2_6) {
    node_floor_ring_2_6.position.copy(endpoint_floor_ring_2_6.start);
    node_floor_ring_2_6.rotation.set(0.0, -0.1590909090909091, 0.0);
  } else {
    node_floor_ring_2_6.position.set(0.011292849467900708, -3.3649999999999998, 0.0);
    node_floor_ring_2_6.rotation.set(0.0, -0.1590909090909091, 0.0);
  }
  node_floor_ring_2_6.userData.sculptComponent = {"id": "floor-ring-2", "name": "Floor slab glint 3", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.2167031753124322, "height": 0.035, "depth": 0.7770892250928505, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.011292849467900708, -3.3649999999999998, 0], "rotation": [0, -0.1590909090909091, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2167031753124322, 0.035, 0.7770892250928505], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-2", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_2_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2167031753124322, 0.035, 0.7770892250928505], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_2_6);
  nodes["floor-ring-2"] = node_floor_ring_2_6;
  const mesh_floor_ring_2_6Geometry = endpoint_floor_ring_2_6
    ? new THREE.CylinderGeometry(endpoint_floor_ring_2_6.endRadius, endpoint_floor_ring_2_6.baseRadius, endpoint_floor_ring_2_6.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_2_6) {
    mesh_floor_ring_2_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_2_6 = new THREE.Mesh(
    mesh_floor_ring_2_6Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_2_6.name = "Floor slab glint 3";
  if (endpoint_floor_ring_2_6) {
    mesh_floor_ring_2_6.position.copy(endpoint_floor_ring_2_6.midpoint);
    mesh_floor_ring_2_6.quaternion.copy(endpoint_floor_ring_2_6.quaternion);
  }
  mesh_floor_ring_2_6.castShadow = options.castShadow ?? true;
  mesh_floor_ring_2_6.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_2_6.userData.sculptComponent = {"id": "floor-ring-2", "name": "Floor slab glint 3", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.2167031753124322, "height": 0.035, "depth": 0.7770892250928505, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.011292849467900708, -3.3649999999999998, 0], "rotation": [0, -0.1590909090909091, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2167031753124322, 0.035, 0.7770892250928505], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-2", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_2_6.add(mesh_floor_ring_2_6);
  meshes["floor-ring-2"] = mesh_floor_ring_2_6;
  colliders["floor-ring-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.2167031753124322, 0.035, 0.7770892250928505], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-2"] ??= [];
  destructionGroups["floor-ring-2"].push(node_floor_ring_2_6);

  const endpoint_tier_3_7 = makeAttachmentEndpoint(null);
  const node_tier_3_7 = new THREE.Group();
  node_tier_3_7.name = "Glass curtainwall tower tier 4__pivot";
  node_tier_3_7.scale.set(1, 1, 1);
  if (endpoint_tier_3_7) {
    node_tier_3_7.position.copy(endpoint_tier_3_7.start);
    node_tier_3_7.rotation.set(0.0, -0.11363636363636365, 0.0);
  } else {
    node_tier_3_7.position.set(0.015666538192549668, -2.1799999999999997, 0.0);
    node_tier_3_7.rotation.set(0.0, -0.11363636363636365, 0.0);
  }
  node_tier_3_7.userData.sculptComponent = {"id": "tier-3", "name": "Glass curtainwall tower tier 4", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1460344225691903, "height": 0.8, "depth": 0.7484973245866239, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.015666538192549668, -2.1799999999999997, 0], "rotation": [0, -0.11363636363636365, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1460344225691903, 0.8, 0.7484973245866239], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-3", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_3_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1460344225691903, 0.8, 0.7484973245866239], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_3_7);
  nodes["tier-3"] = node_tier_3_7;
  const mesh_tier_3_7Geometry = endpoint_tier_3_7
    ? new THREE.CylinderGeometry(endpoint_tier_3_7.endRadius, endpoint_tier_3_7.baseRadius, endpoint_tier_3_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_3_7) {
    mesh_tier_3_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_3_7 = new THREE.Mesh(
    mesh_tier_3_7Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_3_7.name = "Glass curtainwall tower tier 4";
  if (endpoint_tier_3_7) {
    mesh_tier_3_7.position.copy(endpoint_tier_3_7.midpoint);
    mesh_tier_3_7.quaternion.copy(endpoint_tier_3_7.quaternion);
  }
  mesh_tier_3_7.castShadow = options.castShadow ?? true;
  mesh_tier_3_7.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_3_7.userData.sculptComponent = {"id": "tier-3", "name": "Glass curtainwall tower tier 4", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1460344225691903, "height": 0.8, "depth": 0.7484973245866239, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.015666538192549668, -2.1799999999999997, 0], "rotation": [0, -0.11363636363636365, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1460344225691903, 0.8, 0.7484973245866239], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-3", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_3_7.add(mesh_tier_3_7);
  meshes["tier-3"] = mesh_tier_3_7;
  colliders["tier-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.1460344225691903, 0.8, 0.7484973245866239], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-3"] ??= [];
  destructionGroups["tier-3"].push(node_tier_3_7);

  const endpoint_floor_ring_3_8 = makeAttachmentEndpoint(null);
  const node_floor_ring_3_8 = new THREE.Group();
  node_floor_ring_3_8.name = "Floor slab glint 4__pivot";
  node_floor_ring_3_8.scale.set(1, 1, 1);
  if (endpoint_floor_ring_3_8) {
    node_floor_ring_3_8.position.copy(endpoint_floor_ring_3_8.start);
    node_floor_ring_3_8.rotation.set(0.0, -0.11363636363636365, 0.0);
  } else {
    node_floor_ring_3_8.position.set(0.015666538192549668, -2.5749999999999997, 0.0);
    node_floor_ring_3_8.rotation.set(0.0, -0.11363636363636365, 0.0);
  }
  node_floor_ring_3_8.userData.sculptComponent = {"id": "floor-ring-3", "name": "Floor slab glint 4", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1694228801726432, "height": 0.035, "depth": 0.7534973245866239, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.015666538192549668, -2.5749999999999997, 0], "rotation": [0, -0.11363636363636365, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1694228801726432, 0.035, 0.7534973245866239], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-3", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_3_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1694228801726432, 0.035, 0.7534973245866239], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_3_8);
  nodes["floor-ring-3"] = node_floor_ring_3_8;
  const mesh_floor_ring_3_8Geometry = endpoint_floor_ring_3_8
    ? new THREE.CylinderGeometry(endpoint_floor_ring_3_8.endRadius, endpoint_floor_ring_3_8.baseRadius, endpoint_floor_ring_3_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_3_8) {
    mesh_floor_ring_3_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_3_8 = new THREE.Mesh(
    mesh_floor_ring_3_8Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_3_8.name = "Floor slab glint 4";
  if (endpoint_floor_ring_3_8) {
    mesh_floor_ring_3_8.position.copy(endpoint_floor_ring_3_8.midpoint);
    mesh_floor_ring_3_8.quaternion.copy(endpoint_floor_ring_3_8.quaternion);
  }
  mesh_floor_ring_3_8.castShadow = options.castShadow ?? true;
  mesh_floor_ring_3_8.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_3_8.userData.sculptComponent = {"id": "floor-ring-3", "name": "Floor slab glint 4", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1694228801726432, "height": 0.035, "depth": 0.7534973245866239, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.015666538192549668, -2.5749999999999997, 0], "rotation": [0, -0.11363636363636365, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1694228801726432, 0.035, 0.7534973245866239], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-3", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_3_8.add(mesh_floor_ring_3_8);
  meshes["floor-ring-3"] = mesh_floor_ring_3_8;
  colliders["floor-ring-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.1694228801726432, 0.035, 0.7534973245866239], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-3"] ??= [];
  destructionGroups["floor-ring-3"].push(node_floor_ring_3_8);

  const endpoint_tier_4_9 = makeAttachmentEndpoint(null);
  const node_tier_4_9 = new THREE.Group();
  node_tier_4_9.name = "Glass curtainwall tower tier 5__pivot";
  node_tier_4_9.scale.set(1, 1, 1);
  if (endpoint_tier_4_9) {
    node_tier_4_9.position.copy(endpoint_tier_4_9.start);
    node_tier_4_9.rotation.set(0.0, -0.06818181818181818, 0.0);
  } else {
    node_tier_4_9.position.set(0.018640781719344527, -1.3899999999999997, 0.0);
    node_tier_4_9.rotation.set(0.0, -0.06818181818181818, 0.0);
  }
  node_tier_4_9.userData.sculptComponent = {"id": "tier-4", "name": "Glass curtainwall tower tier 5", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1088412098688933, "height": 0.8, "depth": 0.7305880446330233, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.018640781719344527, -1.3899999999999997, 0], "rotation": [0, -0.06818181818181818, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1088412098688933, 0.8, 0.7305880446330233], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-4", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_4_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1088412098688933, 0.8, 0.7305880446330233], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_4_9);
  nodes["tier-4"] = node_tier_4_9;
  const mesh_tier_4_9Geometry = endpoint_tier_4_9
    ? new THREE.CylinderGeometry(endpoint_tier_4_9.endRadius, endpoint_tier_4_9.baseRadius, endpoint_tier_4_9.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_4_9) {
    mesh_tier_4_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_4_9 = new THREE.Mesh(
    mesh_tier_4_9Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_4_9.name = "Glass curtainwall tower tier 5";
  if (endpoint_tier_4_9) {
    mesh_tier_4_9.position.copy(endpoint_tier_4_9.midpoint);
    mesh_tier_4_9.quaternion.copy(endpoint_tier_4_9.quaternion);
  }
  mesh_tier_4_9.castShadow = options.castShadow ?? true;
  mesh_tier_4_9.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_4_9.userData.sculptComponent = {"id": "tier-4", "name": "Glass curtainwall tower tier 5", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1088412098688933, "height": 0.8, "depth": 0.7305880446330233, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.018640781719344527, -1.3899999999999997, 0], "rotation": [0, -0.06818181818181818, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1088412098688933, 0.8, 0.7305880446330233], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-4", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_4_9.add(mesh_tier_4_9);
  meshes["tier-4"] = mesh_tier_4_9;
  colliders["tier-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.1088412098688933, 0.8, 0.7305880446330233], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-4"] ??= [];
  destructionGroups["tier-4"].push(node_tier_4_9);

  const endpoint_floor_ring_4_10 = makeAttachmentEndpoint(null);
  const node_floor_ring_4_10 = new THREE.Group();
  node_floor_ring_4_10.name = "Floor slab glint 5__pivot";
  node_floor_ring_4_10.scale.set(1, 1, 1);
  if (endpoint_floor_ring_4_10) {
    node_floor_ring_4_10.position.copy(endpoint_floor_ring_4_10.start);
    node_floor_ring_4_10.rotation.set(0.0, -0.06818181818181818, 0.0);
  } else {
    node_floor_ring_4_10.position.set(0.018640781719344527, -1.7849999999999997, 0.0);
    node_floor_ring_4_10.rotation.set(0.0, -0.06818181818181818, 0.0);
  }
  node_floor_ring_4_10.userData.sculptComponent = {"id": "floor-ring-4", "name": "Floor slab glint 5", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1314706223151973, "height": 0.035, "depth": 0.7355880446330233, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.018640781719344527, -1.7849999999999997, 0], "rotation": [0, -0.06818181818181818, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1314706223151973, 0.035, 0.7355880446330233], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-4", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_4_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1314706223151973, 0.035, 0.7355880446330233], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_4_10);
  nodes["floor-ring-4"] = node_floor_ring_4_10;
  const mesh_floor_ring_4_10Geometry = endpoint_floor_ring_4_10
    ? new THREE.CylinderGeometry(endpoint_floor_ring_4_10.endRadius, endpoint_floor_ring_4_10.baseRadius, endpoint_floor_ring_4_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_4_10) {
    mesh_floor_ring_4_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_4_10 = new THREE.Mesh(
    mesh_floor_ring_4_10Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_4_10.name = "Floor slab glint 5";
  if (endpoint_floor_ring_4_10) {
    mesh_floor_ring_4_10.position.copy(endpoint_floor_ring_4_10.midpoint);
    mesh_floor_ring_4_10.quaternion.copy(endpoint_floor_ring_4_10.quaternion);
  }
  mesh_floor_ring_4_10.castShadow = options.castShadow ?? true;
  mesh_floor_ring_4_10.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_4_10.userData.sculptComponent = {"id": "floor-ring-4", "name": "Floor slab glint 5", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1314706223151973, "height": 0.035, "depth": 0.7355880446330233, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.018640781719344527, -1.7849999999999997, 0], "rotation": [0, -0.06818181818181818, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1314706223151973, 0.035, 0.7355880446330233], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-4", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_4_10.add(mesh_floor_ring_4_10);
  meshes["floor-ring-4"] = mesh_floor_ring_4_10;
  colliders["floor-ring-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.1314706223151973, 0.035, 0.7355880446330233], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-4"] ??= [];
  destructionGroups["floor-ring-4"].push(node_floor_ring_4_10);

  const endpoint_tier_5_11 = makeAttachmentEndpoint(null);
  const node_tier_5_11 = new THREE.Group();
  node_tier_5_11.name = "Glass curtainwall tower tier 6__pivot";
  node_tier_5_11.scale.set(1, 1, 1);
  if (endpoint_tier_5_11) {
    node_tier_5_11.position.copy(endpoint_tier_5_11.start);
    node_tier_5_11.rotation.set(0.0, -0.022727272727272735, 0.0);
  } else {
    node_tier_5_11.position.set(0.01994989973208109, -0.5999999999999996, 0.0);
    node_tier_5_11.rotation.set(0.0, -0.022727272727272735, 0.0);
  }
  node_tier_5_11.userData.sculptComponent = {"id": "tier-5", "name": "Glass curtainwall tower tier 6", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0820946816312873, "height": 0.8, "depth": 0.7193765832337005, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.01994989973208109, -0.5999999999999996, 0], "rotation": [0, -0.022727272727272735, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0820946816312873, 0.8, 0.7193765832337005], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-5", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_5_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0820946816312873, 0.8, 0.7193765832337005], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_5_11);
  nodes["tier-5"] = node_tier_5_11;
  const mesh_tier_5_11Geometry = endpoint_tier_5_11
    ? new THREE.CylinderGeometry(endpoint_tier_5_11.endRadius, endpoint_tier_5_11.baseRadius, endpoint_tier_5_11.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_5_11) {
    mesh_tier_5_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_5_11 = new THREE.Mesh(
    mesh_tier_5_11Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_5_11.name = "Glass curtainwall tower tier 6";
  if (endpoint_tier_5_11) {
    mesh_tier_5_11.position.copy(endpoint_tier_5_11.midpoint);
    mesh_tier_5_11.quaternion.copy(endpoint_tier_5_11.quaternion);
  }
  mesh_tier_5_11.castShadow = options.castShadow ?? true;
  mesh_tier_5_11.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_5_11.userData.sculptComponent = {"id": "tier-5", "name": "Glass curtainwall tower tier 6", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0820946816312873, "height": 0.8, "depth": 0.7193765832337005, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.01994989973208109, -0.5999999999999996, 0], "rotation": [0, -0.022727272727272735, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0820946816312873, 0.8, 0.7193765832337005], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-5", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_5_11.add(mesh_tier_5_11);
  meshes["tier-5"] = mesh_tier_5_11;
  colliders["tier-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.0820946816312873, 0.8, 0.7193765832337005], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-5"] ??= [];
  destructionGroups["tier-5"].push(node_tier_5_11);

  const endpoint_floor_ring_5_12 = makeAttachmentEndpoint(null);
  const node_floor_ring_5_12 = new THREE.Group();
  node_floor_ring_5_12.name = "Floor slab glint 6__pivot";
  node_floor_ring_5_12.scale.set(1, 1, 1);
  if (endpoint_floor_ring_5_12) {
    node_floor_ring_5_12.position.copy(endpoint_floor_ring_5_12.start);
    node_floor_ring_5_12.rotation.set(0.0, -0.022727272727272735, 0.0);
  } else {
    node_floor_ring_5_12.position.set(0.01994989973208109, -0.9949999999999997, 0.0);
    node_floor_ring_5_12.rotation.set(0.0, -0.022727272727272735, 0.0);
  }
  node_floor_ring_5_12.userData.sculptComponent = {"id": "floor-ring-5", "name": "Floor slab glint 6", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.104178246562538, "height": 0.035, "depth": 0.7243765832337005, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.01994989973208109, -0.9949999999999997, 0], "rotation": [0, -0.022727272727272735, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.104178246562538, 0.035, 0.7243765832337005], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-5", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_5_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.104178246562538, 0.035, 0.7243765832337005], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_5_12);
  nodes["floor-ring-5"] = node_floor_ring_5_12;
  const mesh_floor_ring_5_12Geometry = endpoint_floor_ring_5_12
    ? new THREE.CylinderGeometry(endpoint_floor_ring_5_12.endRadius, endpoint_floor_ring_5_12.baseRadius, endpoint_floor_ring_5_12.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_5_12) {
    mesh_floor_ring_5_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_5_12 = new THREE.Mesh(
    mesh_floor_ring_5_12Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_5_12.name = "Floor slab glint 6";
  if (endpoint_floor_ring_5_12) {
    mesh_floor_ring_5_12.position.copy(endpoint_floor_ring_5_12.midpoint);
    mesh_floor_ring_5_12.quaternion.copy(endpoint_floor_ring_5_12.quaternion);
  }
  mesh_floor_ring_5_12.castShadow = options.castShadow ?? true;
  mesh_floor_ring_5_12.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_5_12.userData.sculptComponent = {"id": "floor-ring-5", "name": "Floor slab glint 6", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.104178246562538, "height": 0.035, "depth": 0.7243765832337005, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.01994989973208109, -0.9949999999999997, 0], "rotation": [0, -0.022727272727272735, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.104178246562538, 0.035, 0.7243765832337005], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-5", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_5_12.add(mesh_floor_ring_5_12);
  meshes["floor-ring-5"] = mesh_floor_ring_5_12;
  colliders["floor-ring-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.104178246562538, 0.035, 0.7243765832337005], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-5"] ??= [];
  destructionGroups["floor-ring-5"].push(node_floor_ring_5_12);

  const endpoint_tier_6_13 = makeAttachmentEndpoint(null);
  const node_tier_6_13 = new THREE.Group();
  node_tier_6_13.name = "Glass curtainwall tower tier 7__pivot";
  node_tier_6_13.scale.set(1, 1, 1);
  if (endpoint_tier_6_13) {
    node_tier_6_13.position.copy(endpoint_tier_6_13.start);
    node_tier_6_13.rotation.set(0.0, 0.022727272727272707, 0.0);
  } else {
    node_tier_6_13.position.set(0.019476952617563905, 0.1900000000000004, 0.0);
    node_tier_6_13.rotation.set(0.0, 0.022727272727272707, 0.0);
  }
  node_tier_6_13.userData.sculptComponent = {"id": "tier-6", "name": "Glass curtainwall tower tier 7", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.066216549839192, "height": 0.8, "depth": 0.7153260394091864, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.019476952617563905, 0.1900000000000004, 0], "rotation": [0, 0.022727272727272707, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.066216549839192, 0.8, 0.7153260394091864], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-6", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_6_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.066216549839192, 0.8, 0.7153260394091864], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_6_13);
  nodes["tier-6"] = node_tier_6_13;
  const mesh_tier_6_13Geometry = endpoint_tier_6_13
    ? new THREE.CylinderGeometry(endpoint_tier_6_13.endRadius, endpoint_tier_6_13.baseRadius, endpoint_tier_6_13.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_6_13) {
    mesh_tier_6_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_6_13 = new THREE.Mesh(
    mesh_tier_6_13Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_6_13.name = "Glass curtainwall tower tier 7";
  if (endpoint_tier_6_13) {
    mesh_tier_6_13.position.copy(endpoint_tier_6_13.midpoint);
    mesh_tier_6_13.quaternion.copy(endpoint_tier_6_13.quaternion);
  }
  mesh_tier_6_13.castShadow = options.castShadow ?? true;
  mesh_tier_6_13.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_6_13.userData.sculptComponent = {"id": "tier-6", "name": "Glass curtainwall tower tier 7", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.066216549839192, "height": 0.8, "depth": 0.7153260394091864, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.019476952617563905, 0.1900000000000004, 0], "rotation": [0, 0.022727272727272707, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.066216549839192, 0.8, 0.7153260394091864], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-6", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_6_13.add(mesh_tier_6_13);
  meshes["tier-6"] = mesh_tier_6_13;
  colliders["tier-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.066216549839192, 0.8, 0.7153260394091864], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-6"] ??= [];
  destructionGroups["tier-6"].push(node_tier_6_13);

  const endpoint_floor_ring_6_14 = makeAttachmentEndpoint(null);
  const node_floor_ring_6_14 = new THREE.Group();
  node_floor_ring_6_14.name = "Floor slab glint 7__pivot";
  node_floor_ring_6_14.scale.set(1, 1, 1);
  if (endpoint_floor_ring_6_14) {
    node_floor_ring_6_14.position.copy(endpoint_floor_ring_6_14.start);
    node_floor_ring_6_14.rotation.set(0.0, 0.022727272727272707, 0.0);
  } else {
    node_floor_ring_6_14.position.set(0.019476952617563905, -0.20499999999999963, 0.0);
    node_floor_ring_6_14.rotation.set(0.0, 0.022727272727272707, 0.0);
  }
  node_floor_ring_6_14.userData.sculptComponent = {"id": "floor-ring-6", "name": "Floor slab glint 7", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0879760712644817, "height": 0.035, "depth": 0.7203260394091864, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.019476952617563905, -0.20499999999999963, 0], "rotation": [0, 0.022727272727272707, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0879760712644817, 0.035, 0.7203260394091864], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-6", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_6_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0879760712644817, 0.035, 0.7203260394091864], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_6_14);
  nodes["floor-ring-6"] = node_floor_ring_6_14;
  const mesh_floor_ring_6_14Geometry = endpoint_floor_ring_6_14
    ? new THREE.CylinderGeometry(endpoint_floor_ring_6_14.endRadius, endpoint_floor_ring_6_14.baseRadius, endpoint_floor_ring_6_14.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_6_14) {
    mesh_floor_ring_6_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_6_14 = new THREE.Mesh(
    mesh_floor_ring_6_14Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_6_14.name = "Floor slab glint 7";
  if (endpoint_floor_ring_6_14) {
    mesh_floor_ring_6_14.position.copy(endpoint_floor_ring_6_14.midpoint);
    mesh_floor_ring_6_14.quaternion.copy(endpoint_floor_ring_6_14.quaternion);
  }
  mesh_floor_ring_6_14.castShadow = options.castShadow ?? true;
  mesh_floor_ring_6_14.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_6_14.userData.sculptComponent = {"id": "floor-ring-6", "name": "Floor slab glint 7", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0879760712644817, "height": 0.035, "depth": 0.7203260394091864, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.019476952617563905, -0.20499999999999963, 0], "rotation": [0, 0.022727272727272707, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0879760712644817, 0.035, 0.7203260394091864], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-6", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_6_14.add(mesh_floor_ring_6_14);
  meshes["floor-ring-6"] = mesh_floor_ring_6_14;
  colliders["floor-ring-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.0879760712644817, 0.035, 0.7203260394091864], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-6"] ??= [];
  destructionGroups["floor-ring-6"].push(node_floor_ring_6_14);

  const endpoint_tier_7_15 = makeAttachmentEndpoint(null);
  const node_tier_7_15 = new THREE.Group();
  node_tier_7_15.name = "Glass curtainwall tower tier 8__pivot";
  node_tier_7_15.scale.set(1, 1, 1);
  if (endpoint_tier_7_15) {
    node_tier_7_15.position.copy(endpoint_tier_7_15.start);
    node_tier_7_15.rotation.set(0.0, 0.06818181818181818, 0.0);
  } else {
    node_tier_7_15.position.set(0.017264187332977476, 0.9800000000000004, 0.0);
    node_tier_7_15.rotation.set(0.0, 0.06818181818181818, 0.0);
  }
  node_tier_7_15.userData.sculptComponent = {"id": "tier-7", "name": "Glass curtainwall tower tier 8", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0607353005470326, "height": 0.8, "depth": 0.7183161289896913, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.017264187332977476, 0.9800000000000004, 0], "rotation": [0, 0.06818181818181818, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0607353005470326, 0.8, 0.7183161289896913], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-7", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_7_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0607353005470326, 0.8, 0.7183161289896913], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_7_15);
  nodes["tier-7"] = node_tier_7_15;
  const mesh_tier_7_15Geometry = endpoint_tier_7_15
    ? new THREE.CylinderGeometry(endpoint_tier_7_15.endRadius, endpoint_tier_7_15.baseRadius, endpoint_tier_7_15.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_7_15) {
    mesh_tier_7_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_7_15 = new THREE.Mesh(
    mesh_tier_7_15Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_7_15.name = "Glass curtainwall tower tier 8";
  if (endpoint_tier_7_15) {
    mesh_tier_7_15.position.copy(endpoint_tier_7_15.midpoint);
    mesh_tier_7_15.quaternion.copy(endpoint_tier_7_15.quaternion);
  }
  mesh_tier_7_15.castShadow = options.castShadow ?? true;
  mesh_tier_7_15.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_7_15.userData.sculptComponent = {"id": "tier-7", "name": "Glass curtainwall tower tier 8", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0607353005470326, "height": 0.8, "depth": 0.7183161289896913, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.017264187332977476, 0.9800000000000004, 0], "rotation": [0, 0.06818181818181818, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0607353005470326, 0.8, 0.7183161289896913], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-7", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_7_15.add(mesh_tier_7_15);
  meshes["tier-7"] = mesh_tier_7_15;
  colliders["tier-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.0607353005470326, 0.8, 0.7183161289896913], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-7"] ??= [];
  destructionGroups["tier-7"].push(node_tier_7_15);

  const endpoint_floor_ring_7_16 = makeAttachmentEndpoint(null);
  const node_floor_ring_7_16 = new THREE.Group();
  node_floor_ring_7_16.name = "Floor slab glint 8__pivot";
  node_floor_ring_7_16.scale.set(1, 1, 1);
  if (endpoint_floor_ring_7_16) {
    node_floor_ring_7_16.position.copy(endpoint_floor_ring_7_16.start);
    node_floor_ring_7_16.rotation.set(0.0, 0.06818181818181818, 0.0);
  } else {
    node_floor_ring_7_16.position.set(0.017264187332977476, 0.5850000000000004, 0.0);
    node_floor_ring_7_16.rotation.set(0.0, 0.06818181818181818, 0.0);
  }
  node_floor_ring_7_16.userData.sculptComponent = {"id": "floor-ring-7", "name": "Floor slab glint 8", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.08238295974187, "height": 0.035, "depth": 0.7233161289896913, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.017264187332977476, 0.5850000000000004, 0], "rotation": [0, 0.06818181818181818, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.08238295974187, 0.035, 0.7233161289896913], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-7", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_7_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.08238295974187, 0.035, 0.7233161289896913], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_7_16);
  nodes["floor-ring-7"] = node_floor_ring_7_16;
  const mesh_floor_ring_7_16Geometry = endpoint_floor_ring_7_16
    ? new THREE.CylinderGeometry(endpoint_floor_ring_7_16.endRadius, endpoint_floor_ring_7_16.baseRadius, endpoint_floor_ring_7_16.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_7_16) {
    mesh_floor_ring_7_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_7_16 = new THREE.Mesh(
    mesh_floor_ring_7_16Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_7_16.name = "Floor slab glint 8";
  if (endpoint_floor_ring_7_16) {
    mesh_floor_ring_7_16.position.copy(endpoint_floor_ring_7_16.midpoint);
    mesh_floor_ring_7_16.quaternion.copy(endpoint_floor_ring_7_16.quaternion);
  }
  mesh_floor_ring_7_16.castShadow = options.castShadow ?? true;
  mesh_floor_ring_7_16.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_7_16.userData.sculptComponent = {"id": "floor-ring-7", "name": "Floor slab glint 8", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.08238295974187, "height": 0.035, "depth": 0.7233161289896913, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.017264187332977476, 0.5850000000000004, 0], "rotation": [0, 0.06818181818181818, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.08238295974187, 0.035, 0.7233161289896913], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-7", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_7_16.add(mesh_floor_ring_7_16);
  meshes["floor-ring-7"] = mesh_floor_ring_7_16;
  colliders["floor-ring-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.08238295974187, 0.035, 0.7233161289896913], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-7"] ??= [];
  destructionGroups["floor-ring-7"].push(node_floor_ring_7_16);

  const endpoint_tier_8_17 = makeAttachmentEndpoint(null);
  const node_tier_8_17 = new THREE.Group();
  node_tier_8_17.name = "Glass curtainwall tower tier 9__pivot";
  node_tier_8_17.scale.set(1, 1, 1);
  if (endpoint_tier_8_17) {
    node_tier_8_17.position.copy(endpoint_tier_8_17.start);
    node_tier_8_17.rotation.set(0.0, 0.11363636363636365, 0.0);
  } else {
    node_tier_8_17.position.set(0.01350926361102302, 1.7700000000000005, 0.0);
    node_tier_8_17.rotation.set(0.0, 0.11363636363636365, 0.0);
  }
  node_tier_8_17.userData.sculptComponent = {"id": "tier-8", "name": "Glass curtainwall tower tier 9", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0643498593069527, "height": 0.8, "depth": 0.7276594257952368, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.01350926361102302, 1.7700000000000005, 0], "rotation": [0, 0.11363636363636365, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0643498593069527, 0.8, 0.7276594257952368], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-8", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_8_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0643498593069527, 0.8, 0.7276594257952368], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_8_17);
  nodes["tier-8"] = node_tier_8_17;
  const mesh_tier_8_17Geometry = endpoint_tier_8_17
    ? new THREE.CylinderGeometry(endpoint_tier_8_17.endRadius, endpoint_tier_8_17.baseRadius, endpoint_tier_8_17.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_8_17) {
    mesh_tier_8_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_8_17 = new THREE.Mesh(
    mesh_tier_8_17Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_8_17.name = "Glass curtainwall tower tier 9";
  if (endpoint_tier_8_17) {
    mesh_tier_8_17.position.copy(endpoint_tier_8_17.midpoint);
    mesh_tier_8_17.quaternion.copy(endpoint_tier_8_17.quaternion);
  }
  mesh_tier_8_17.castShadow = options.castShadow ?? true;
  mesh_tier_8_17.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_8_17.userData.sculptComponent = {"id": "tier-8", "name": "Glass curtainwall tower tier 9", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0643498593069527, "height": 0.8, "depth": 0.7276594257952368, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.01350926361102302, 1.7700000000000005, 0], "rotation": [0, 0.11363636363636365, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0643498593069527, 0.8, 0.7276594257952368], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-8", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_8_17.add(mesh_tier_8_17);
  meshes["tier-8"] = mesh_tier_8_17;
  colliders["tier-8"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.0643498593069527, 0.8, 0.7276594257952368], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-8"] ??= [];
  destructionGroups["tier-8"].push(node_tier_8_17);

  const endpoint_floor_ring_8_18 = makeAttachmentEndpoint(null);
  const node_floor_ring_8_18 = new THREE.Group();
  node_floor_ring_8_18.name = "Floor slab glint 9__pivot";
  node_floor_ring_8_18.scale.set(1, 1, 1);
  if (endpoint_floor_ring_8_18) {
    node_floor_ring_8_18.position.copy(endpoint_floor_ring_8_18.start);
    node_floor_ring_8_18.rotation.set(0.0, 0.11363636363636365, 0.0);
  } else {
    node_floor_ring_8_18.position.set(0.01350926361102302, 1.3750000000000004, 0.0);
    node_floor_ring_8_18.rotation.set(0.0, 0.11363636363636365, 0.0);
  }
  node_floor_ring_8_18.userData.sculptComponent = {"id": "floor-ring-8", "name": "Floor slab glint 9", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0860712850070946, "height": 0.035, "depth": 0.7326594257952368, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.01350926361102302, 1.3750000000000004, 0], "rotation": [0, 0.11363636363636365, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0860712850070946, 0.035, 0.7326594257952368], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-8", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_8_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0860712850070946, 0.035, 0.7326594257952368], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_8_18);
  nodes["floor-ring-8"] = node_floor_ring_8_18;
  const mesh_floor_ring_8_18Geometry = endpoint_floor_ring_8_18
    ? new THREE.CylinderGeometry(endpoint_floor_ring_8_18.endRadius, endpoint_floor_ring_8_18.baseRadius, endpoint_floor_ring_8_18.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_8_18) {
    mesh_floor_ring_8_18Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_8_18 = new THREE.Mesh(
    mesh_floor_ring_8_18Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_8_18.name = "Floor slab glint 9";
  if (endpoint_floor_ring_8_18) {
    mesh_floor_ring_8_18.position.copy(endpoint_floor_ring_8_18.midpoint);
    mesh_floor_ring_8_18.quaternion.copy(endpoint_floor_ring_8_18.quaternion);
  }
  mesh_floor_ring_8_18.castShadow = options.castShadow ?? true;
  mesh_floor_ring_8_18.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_8_18.userData.sculptComponent = {"id": "floor-ring-8", "name": "Floor slab glint 9", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0860712850070946, "height": 0.035, "depth": 0.7326594257952368, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.01350926361102302, 1.3750000000000004, 0], "rotation": [0, 0.11363636363636365, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0860712850070946, 0.035, 0.7326594257952368], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-8", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_8_18.add(mesh_floor_ring_8_18);
  meshes["floor-ring-8"] = mesh_floor_ring_8_18;
  colliders["floor-ring-8"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.0860712850070946, 0.035, 0.7326594257952368], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-8"] ??= [];
  destructionGroups["floor-ring-8"].push(node_floor_ring_8_18);

  const endpoint_tier_9_19 = makeAttachmentEndpoint(null);
  const node_tier_9_19 = new THREE.Group();
  node_tier_9_19.name = "Glass curtainwall tower tier 10__pivot";
  node_tier_9_19.scale.set(1, 1, 1);
  if (endpoint_tier_9_19) {
    node_tier_9_19.position.copy(endpoint_tier_9_19.start);
    node_tier_9_19.rotation.set(0.0, 0.15909090909090912, 0.0);
  } else {
    node_tier_9_19.position.set(0.008547597604676603, 2.5600000000000005, 0.0);
    node_tier_9_19.rotation.set(0.0, 0.15909090909090912, 0.0);
  }
  node_tier_9_19.userData.sculptComponent = {"id": "tier-9", "name": "Glass curtainwall tower tier 10", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0750594310944017, "height": 0.8, "depth": 0.7421632861357632, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.008547597604676603, 2.5600000000000005, 0], "rotation": [0, 0.15909090909090912, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0750594310944017, 0.8, 0.7421632861357632], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-9", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_9_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0750594310944017, 0.8, 0.7421632861357632], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_9_19);
  nodes["tier-9"] = node_tier_9_19;
  const mesh_tier_9_19Geometry = endpoint_tier_9_19
    ? new THREE.CylinderGeometry(endpoint_tier_9_19.endRadius, endpoint_tier_9_19.baseRadius, endpoint_tier_9_19.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_9_19) {
    mesh_tier_9_19Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_9_19 = new THREE.Mesh(
    mesh_tier_9_19Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_9_19.name = "Glass curtainwall tower tier 10";
  if (endpoint_tier_9_19) {
    mesh_tier_9_19.position.copy(endpoint_tier_9_19.midpoint);
    mesh_tier_9_19.quaternion.copy(endpoint_tier_9_19.quaternion);
  }
  mesh_tier_9_19.castShadow = options.castShadow ?? true;
  mesh_tier_9_19.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_9_19.userData.sculptComponent = {"id": "tier-9", "name": "Glass curtainwall tower tier 10", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0750594310944017, "height": 0.8, "depth": 0.7421632861357632, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.008547597604676603, 2.5600000000000005, 0], "rotation": [0, 0.15909090909090912, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0750594310944017, 0.8, 0.7421632861357632], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-9", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_9_19.add(mesh_tier_9_19);
  meshes["tier-9"] = mesh_tier_9_19;
  colliders["tier-9"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.0750594310944017, 0.8, 0.7421632861357632], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-9"] ??= [];
  destructionGroups["tier-9"].push(node_tier_9_19);

  const endpoint_floor_ring_9_20 = makeAttachmentEndpoint(null);
  const node_floor_ring_9_20 = new THREE.Group();
  node_floor_ring_9_20.name = "Floor slab glint 10__pivot";
  node_floor_ring_9_20.scale.set(1, 1, 1);
  if (endpoint_floor_ring_9_20) {
    node_floor_ring_9_20.position.copy(endpoint_floor_ring_9_20.start);
    node_floor_ring_9_20.rotation.set(0.0, 0.15909090909090912, 0.0);
  } else {
    node_floor_ring_9_20.position.set(0.008547597604676603, 2.1650000000000005, 0.0);
    node_floor_ring_9_20.rotation.set(0.0, 0.15909090909090912, 0.0);
  }
  node_floor_ring_9_20.userData.sculptComponent = {"id": "floor-ring-9", "name": "Floor slab glint 10", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0969994194840833, "height": 0.035, "depth": 0.7471632861357632, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.008547597604676603, 2.1650000000000005, 0], "rotation": [0, 0.15909090909090912, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0969994194840833, 0.035, 0.7471632861357632], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-9", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_9_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0969994194840833, 0.035, 0.7471632861357632], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_9_20);
  nodes["floor-ring-9"] = node_floor_ring_9_20;
  const mesh_floor_ring_9_20Geometry = endpoint_floor_ring_9_20
    ? new THREE.CylinderGeometry(endpoint_floor_ring_9_20.endRadius, endpoint_floor_ring_9_20.baseRadius, endpoint_floor_ring_9_20.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_9_20) {
    mesh_floor_ring_9_20Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_9_20 = new THREE.Mesh(
    mesh_floor_ring_9_20Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_9_20.name = "Floor slab glint 10";
  if (endpoint_floor_ring_9_20) {
    mesh_floor_ring_9_20.position.copy(endpoint_floor_ring_9_20.midpoint);
    mesh_floor_ring_9_20.quaternion.copy(endpoint_floor_ring_9_20.quaternion);
  }
  mesh_floor_ring_9_20.castShadow = options.castShadow ?? true;
  mesh_floor_ring_9_20.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_9_20.userData.sculptComponent = {"id": "floor-ring-9", "name": "Floor slab glint 10", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0969994194840833, "height": 0.035, "depth": 0.7471632861357632, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.008547597604676603, 2.1650000000000005, 0], "rotation": [0, 0.15909090909090912, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0969994194840833, 0.035, 0.7471632861357632], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-9", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_9_20.add(mesh_floor_ring_9_20);
  meshes["floor-ring-9"] = mesh_floor_ring_9_20;
  colliders["floor-ring-9"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.0969994194840833, 0.035, 0.7471632861357632], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-9"] ??= [];
  destructionGroups["floor-ring-9"].push(node_floor_ring_9_20);

  const endpoint_tier_10_21 = makeAttachmentEndpoint(null);
  const node_tier_10_21 = new THREE.Group();
  node_tier_10_21.name = "Glass curtainwall tower tier 11__pivot";
  node_tier_10_21.scale.set(1, 1, 1);
  if (endpoint_tier_10_21) {
    node_tier_10_21.position.copy(endpoint_tier_10_21.start);
    node_tier_10_21.rotation.set(0.0, 0.20454545454545453, 0.0);
  } else {
    node_tier_10_21.position.set(0.002822400161197344, 3.3500000000000005, 0.0);
    node_tier_10_21.rotation.set(0.0, 0.20454545454545453, 0.0);
  }
  node_tier_10_21.userData.sculptComponent = {"id": "tier-10", "name": "Glass curtainwall tower tier 11", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0903470163276907, "height": 0.8, "depth": 0.7602319348900392, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.002822400161197344, 3.3500000000000005, 0], "rotation": [0, 0.20454545454545453, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0903470163276907, 0.8, 0.7602319348900392], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-10", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_10_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0903470163276907, 0.8, 0.7602319348900392], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_10_21);
  nodes["tier-10"] = node_tier_10_21;
  const mesh_tier_10_21Geometry = endpoint_tier_10_21
    ? new THREE.CylinderGeometry(endpoint_tier_10_21.endRadius, endpoint_tier_10_21.baseRadius, endpoint_tier_10_21.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_10_21) {
    mesh_tier_10_21Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_10_21 = new THREE.Mesh(
    mesh_tier_10_21Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_10_21.name = "Glass curtainwall tower tier 11";
  if (endpoint_tier_10_21) {
    mesh_tier_10_21.position.copy(endpoint_tier_10_21.midpoint);
    mesh_tier_10_21.quaternion.copy(endpoint_tier_10_21.quaternion);
  }
  mesh_tier_10_21.castShadow = options.castShadow ?? true;
  mesh_tier_10_21.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_10_21.userData.sculptComponent = {"id": "tier-10", "name": "Glass curtainwall tower tier 11", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0903470163276907, "height": 0.8, "depth": 0.7602319348900392, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.002822400161197344, 3.3500000000000005, 0], "rotation": [0, 0.20454545454545453, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.0903470163276907, 0.8, 0.7602319348900392], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-10", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_10_21.add(mesh_tier_10_21);
  meshes["tier-10"] = mesh_tier_10_21;
  colliders["tier-10"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.0903470163276907, 0.8, 0.7602319348900392], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-10"] ??= [];
  destructionGroups["tier-10"].push(node_tier_10_21);

  const endpoint_floor_ring_10_22 = makeAttachmentEndpoint(null);
  const node_floor_ring_10_22 = new THREE.Group();
  node_floor_ring_10_22.name = "Floor slab glint 11__pivot";
  node_floor_ring_10_22.scale.set(1, 1, 1);
  if (endpoint_floor_ring_10_22) {
    node_floor_ring_10_22.position.copy(endpoint_floor_ring_10_22.start);
    node_floor_ring_10_22.rotation.set(0.0, 0.20454545454545453, 0.0);
  } else {
    node_floor_ring_10_22.position.set(0.002822400161197344, 2.9550000000000005, 0.0);
    node_floor_ring_10_22.rotation.set(0.0, 0.20454545454545453, 0.0);
  }
  node_floor_ring_10_22.userData.sculptComponent = {"id": "floor-ring-10", "name": "Floor slab glint 11", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1125989962527456, "height": 0.035, "depth": 0.7652319348900392, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.002822400161197344, 2.9550000000000005, 0], "rotation": [0, 0.20454545454545453, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1125989962527456, 0.035, 0.7652319348900392], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-10", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_10_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1125989962527456, 0.035, 0.7652319348900392], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_10_22);
  nodes["floor-ring-10"] = node_floor_ring_10_22;
  const mesh_floor_ring_10_22Geometry = endpoint_floor_ring_10_22
    ? new THREE.CylinderGeometry(endpoint_floor_ring_10_22.endRadius, endpoint_floor_ring_10_22.baseRadius, endpoint_floor_ring_10_22.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_10_22) {
    mesh_floor_ring_10_22Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_10_22 = new THREE.Mesh(
    mesh_floor_ring_10_22Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_10_22.name = "Floor slab glint 11";
  if (endpoint_floor_ring_10_22) {
    mesh_floor_ring_10_22.position.copy(endpoint_floor_ring_10_22.midpoint);
    mesh_floor_ring_10_22.quaternion.copy(endpoint_floor_ring_10_22.quaternion);
  }
  mesh_floor_ring_10_22.castShadow = options.castShadow ?? true;
  mesh_floor_ring_10_22.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_10_22.userData.sculptComponent = {"id": "floor-ring-10", "name": "Floor slab glint 11", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1125989962527456, "height": 0.035, "depth": 0.7652319348900392, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.002822400161197344, 2.9550000000000005, 0], "rotation": [0, 0.20454545454545453, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1125989962527456, 0.035, 0.7652319348900392], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-10", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_10_22.add(mesh_floor_ring_10_22);
  meshes["floor-ring-10"] = mesh_floor_ring_10_22;
  colliders["floor-ring-10"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.1125989962527456, 0.035, 0.7652319348900392], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-10"] ??= [];
  destructionGroups["floor-ring-10"].push(node_floor_ring_10_22);

  const endpoint_tier_11_23 = makeAttachmentEndpoint(null);
  const node_tier_11_23 = new THREE.Group();
  node_tier_11_23.name = "Glass curtainwall tower tier 12__pivot";
  node_tier_11_23.scale.set(1, 1, 1);
  if (endpoint_tier_11_23) {
    node_tier_11_23.position.copy(endpoint_tier_11_23.start);
    node_tier_11_23.rotation.set(0.0, 0.25, 0.0);
  } else {
    node_tier_11_23.position.set(-0.0031549138828649644, 4.1400000000000015, 0.0);
    node_tier_11_23.rotation.set(0.0, 0.25, 0.0);
  }
  node_tier_11_23.userData.sculptComponent = {"id": "tier-11", "name": "Glass curtainwall tower tier 12", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1074000000000002, "height": 0.8, "depth": 0.7799999999999999, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.0031549138828649644, 4.1400000000000015, 0], "rotation": [0, 0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1074000000000002, 0.8, 0.7799999999999999], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-11", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_11_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1074000000000002, 0.8, 0.7799999999999999], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tier_11_23);
  nodes["tier-11"] = node_tier_11_23;
  const mesh_tier_11_23Geometry = endpoint_tier_11_23
    ? new THREE.CylinderGeometry(endpoint_tier_11_23.endRadius, endpoint_tier_11_23.baseRadius, endpoint_tier_11_23.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tier_11_23) {
    mesh_tier_11_23Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tier_11_23 = new THREE.Mesh(
    mesh_tier_11_23Geometry,
    materialMap["reflective-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tier_11_23.name = "Glass curtainwall tower tier 12";
  if (endpoint_tier_11_23) {
    mesh_tier_11_23.position.copy(endpoint_tier_11_23.midpoint);
    mesh_tier_11_23.quaternion.copy(endpoint_tier_11_23.quaternion);
  }
  mesh_tier_11_23.castShadow = options.castShadow ?? true;
  mesh_tier_11_23.receiveShadow = options.receiveShadow ?? true;
  mesh_tier_11_23.userData.sculptComponent = {"id": "tier-11", "name": "Glass curtainwall tower tier 12", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1074000000000002, "height": 0.8, "depth": 0.7799999999999999, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.0031549138828649644, 4.1400000000000015, 0], "rotation": [0, 0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1074000000000002, 0.8, 0.7799999999999999], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tier-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "reflective-glass", "materialLayers": ["reflective-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "panel-band-11", "kind": "linework", "notes": "horizontal glass floor bands"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 171, 193, 1.0)", "secondaryAlbedo": "rgba(139, 171, 193, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_tier_11_23.add(mesh_tier_11_23);
  meshes["tier-11"] = mesh_tier_11_23;
  colliders["tier-11"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.1074000000000002, 0.8, 0.7799999999999999], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tier-11"] ??= [];
  destructionGroups["tier-11"].push(node_tier_11_23);

  const endpoint_floor_ring_11_24 = makeAttachmentEndpoint(null);
  const node_floor_ring_11_24 = new THREE.Group();
  node_floor_ring_11_24.name = "Floor slab glint 12__pivot";
  node_floor_ring_11_24.scale.set(1, 1, 1);
  if (endpoint_floor_ring_11_24) {
    node_floor_ring_11_24.position.copy(endpoint_floor_ring_11_24.start);
    node_floor_ring_11_24.rotation.set(0.0, 0.25, 0.0);
  } else {
    node_floor_ring_11_24.position.set(-0.0031549138828649644, 3.7450000000000014, 0.0);
    node_floor_ring_11_24.rotation.set(0.0, 0.25, 0.0);
  }
  node_floor_ring_11_24.userData.sculptComponent = {"id": "floor-ring-11", "name": "Floor slab glint 12", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1300000000000001, "height": 0.035, "depth": 0.7849999999999999, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.0031549138828649644, 3.7450000000000014, 0], "rotation": [0, 0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1300000000000001, 0.035, 0.7849999999999999], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-11", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_11_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1300000000000001, 0.035, 0.7849999999999999], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_floor_ring_11_24);
  nodes["floor-ring-11"] = node_floor_ring_11_24;
  const mesh_floor_ring_11_24Geometry = endpoint_floor_ring_11_24
    ? new THREE.CylinderGeometry(endpoint_floor_ring_11_24.endRadius, endpoint_floor_ring_11_24.baseRadius, endpoint_floor_ring_11_24.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_floor_ring_11_24) {
    mesh_floor_ring_11_24Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_floor_ring_11_24 = new THREE.Mesh(
    mesh_floor_ring_11_24Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_ring_11_24.name = "Floor slab glint 12";
  if (endpoint_floor_ring_11_24) {
    mesh_floor_ring_11_24.position.copy(endpoint_floor_ring_11_24.midpoint);
    mesh_floor_ring_11_24.quaternion.copy(endpoint_floor_ring_11_24.quaternion);
  }
  mesh_floor_ring_11_24.castShadow = options.castShadow ?? true;
  mesh_floor_ring_11_24.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_ring_11_24.userData.sculptComponent = {"id": "floor-ring-11", "name": "Floor slab glint 12", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.1300000000000001, "height": 0.035, "depth": 0.7849999999999999, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.0031549138828649644, 3.7450000000000014, 0], "rotation": [0, 0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.1300000000000001, 0.035, 0.7849999999999999], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-ring-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "facade-rim-11", "kind": "seam", "notes": "subtle horizontal mullion seam"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_floor_ring_11_24.add(mesh_floor_ring_11_24);
  meshes["floor-ring-11"] = mesh_floor_ring_11_24;
  colliders["floor-ring-11"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.1300000000000001, 0.035, 0.7849999999999999], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["floor-ring-11"] ??= [];
  destructionGroups["floor-ring-11"].push(node_floor_ring_11_24);

  const endpoint_top_plate_25 = makeAttachmentEndpoint(null);
  const node_top_plate_25 = new THREE.Group();
  node_top_plate_25.name = "Sloping silver roof cap__pivot";
  node_top_plate_25.scale.set(1, 1, 1);
  if (endpoint_top_plate_25) {
    node_top_plate_25.position.copy(endpoint_top_plate_25.start);
    node_top_plate_25.rotation.set(0.0, 0.28, 0.0);
  } else {
    node_top_plate_25.position.set(0.0, 4.55, 0.0);
    node_top_plate_25.rotation.set(0.0, 0.28, 0.0);
  }
  node_top_plate_25.userData.sculptComponent = {"id": "top-plate", "name": "Sloping silver roof cap", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.17, "height": 0.105, "depth": 0.74, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 4.55, 0], "rotation": [0, 0.28, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.17, 0.105, 0.74], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-plate", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_top_plate_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.17, 0.105, 0.74], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-plate", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_top_plate_25);
  nodes["top-plate"] = node_top_plate_25;
  const mesh_top_plate_25Geometry = endpoint_top_plate_25
    ? new THREE.CylinderGeometry(endpoint_top_plate_25.endRadius, endpoint_top_plate_25.baseRadius, endpoint_top_plate_25.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_top_plate_25) {
    mesh_top_plate_25Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_top_plate_25 = new THREE.Mesh(
    mesh_top_plate_25Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_top_plate_25.name = "Sloping silver roof cap";
  if (endpoint_top_plate_25) {
    mesh_top_plate_25.position.copy(endpoint_top_plate_25.midpoint);
    mesh_top_plate_25.quaternion.copy(endpoint_top_plate_25.quaternion);
  }
  mesh_top_plate_25.castShadow = options.castShadow ?? true;
  mesh_top_plate_25.receiveShadow = options.receiveShadow ?? true;
  mesh_top_plate_25.userData.sculptComponent = {"id": "top-plate", "name": "Sloping silver roof cap", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.17, "height": 0.105, "depth": 0.74, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 4.55, 0], "rotation": [0, 0.28, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.17, 0.105, 0.74], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-plate", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_top_plate_25.add(mesh_top_plate_25);
  meshes["top-plate"] = mesh_top_plate_25;
  colliders["top-plate"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.17, 0.105, 0.74], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["top-plate"] ??= [];
  destructionGroups["top-plate"].push(node_top_plate_25);

  const endpoint_inner_core_26 = makeAttachmentEndpoint(null);
  const node_inner_core_26 = new THREE.Group();
  node_inner_core_26.name = "Dark internal elevator-core structural mass__pivot";
  node_inner_core_26.scale.set(1, 1, 1);
  if (endpoint_inner_core_26) {
    node_inner_core_26.position.copy(endpoint_inner_core_26.start);
    node_inner_core_26.rotation.set(0.0, 0.05, 0.0);
  } else {
    node_inner_core_26.position.set(0.0, 0.0, 0.0);
    node_inner_core_26.rotation.set(0.0, 0.05, 0.0);
  }
  node_inner_core_26.userData.sculptComponent = {"id": "inner-core", "name": "Dark internal elevator-core structural mass", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.45, "height": 8.8, "depth": 0.44, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0.05, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.45, 8.8, 0.44], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "inner-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_inner_core_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.45, 8.8, 0.44], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "inner-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_inner_core_26);
  nodes["inner-core"] = node_inner_core_26;
  const mesh_inner_core_26Geometry = endpoint_inner_core_26
    ? new THREE.CylinderGeometry(endpoint_inner_core_26.endRadius, endpoint_inner_core_26.baseRadius, endpoint_inner_core_26.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_inner_core_26) {
    mesh_inner_core_26Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_inner_core_26 = new THREE.Mesh(
    mesh_inner_core_26Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_inner_core_26.name = "Dark internal elevator-core structural mass";
  if (endpoint_inner_core_26) {
    mesh_inner_core_26.position.copy(endpoint_inner_core_26.midpoint);
    mesh_inner_core_26.quaternion.copy(endpoint_inner_core_26.quaternion);
  }
  mesh_inner_core_26.castShadow = options.castShadow ?? true;
  mesh_inner_core_26.receiveShadow = options.receiveShadow ?? true;
  mesh_inner_core_26.userData.sculptComponent = {"id": "inner-core", "name": "Dark internal elevator-core structural mass", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.45, "height": 8.8, "depth": 0.44, "units": "relative", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0.05, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.45, 8.8, 0.44], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "inner-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_inner_core_26.add(mesh_inner_core_26);
  meshes["inner-core"] = mesh_inner_core_26;
  colliders["inner-core"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.45, 8.8, 0.44], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["inner-core"] ??= [];
  destructionGroups["inner-core"].push(node_inner_core_26);

  const endpoint_pane_divider_0_27 = makeAttachmentEndpoint(null);
  const node_pane_divider_0_27 = new THREE.Group();
  node_pane_divider_0_27.name = "Curtain-wall vertical glazing mullion 1__pivot";
  node_pane_divider_0_27.scale.set(1, 1, 1);
  if (endpoint_pane_divider_0_27) {
    node_pane_divider_0_27.position.copy(endpoint_pane_divider_0_27.start);
    node_pane_divider_0_27.rotation.set(0.0, -0.25, 0.0);
  } else {
    node_pane_divider_0_27.position.set(-0.4375, -4.5, 0.405);
    node_pane_divider_0_27.rotation.set(0.0, -0.25, 0.0);
  }
  node_pane_divider_0_27.userData.sculptComponent = {"id": "pane-divider-0", "name": "Curtain-wall vertical glazing mullion 1", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4375, -4.5, 0.405], "rotation": [0, -0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-0", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_0_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_0_27);
  nodes["pane-divider-0"] = node_pane_divider_0_27;
  const mesh_pane_divider_0_27Geometry = endpoint_pane_divider_0_27
    ? new THREE.CylinderGeometry(endpoint_pane_divider_0_27.endRadius, endpoint_pane_divider_0_27.baseRadius, endpoint_pane_divider_0_27.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_0_27) {
    mesh_pane_divider_0_27Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_0_27 = new THREE.Mesh(
    mesh_pane_divider_0_27Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_0_27.name = "Curtain-wall vertical glazing mullion 1";
  if (endpoint_pane_divider_0_27) {
    mesh_pane_divider_0_27.position.copy(endpoint_pane_divider_0_27.midpoint);
    mesh_pane_divider_0_27.quaternion.copy(endpoint_pane_divider_0_27.quaternion);
  }
  mesh_pane_divider_0_27.castShadow = options.castShadow ?? true;
  mesh_pane_divider_0_27.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_0_27.userData.sculptComponent = {"id": "pane-divider-0", "name": "Curtain-wall vertical glazing mullion 1", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4375, -4.5, 0.405], "rotation": [0, -0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-0", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_0_27.add(mesh_pane_divider_0_27);
  meshes["pane-divider-0"] = mesh_pane_divider_0_27;
  colliders["pane-divider-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-0"] ??= [];
  destructionGroups["pane-divider-0"].push(node_pane_divider_0_27);

  const endpoint_pane_divider_1_28 = makeAttachmentEndpoint(null);
  const node_pane_divider_1_28 = new THREE.Group();
  node_pane_divider_1_28.name = "Curtain-wall vertical glazing mullion 2__pivot";
  node_pane_divider_1_28.scale.set(1, 1, 1);
  if (endpoint_pane_divider_1_28) {
    node_pane_divider_1_28.position.copy(endpoint_pane_divider_1_28.start);
    node_pane_divider_1_28.rotation.set(0.0, -0.2282608695652174, 0.0);
  } else {
    node_pane_divider_1_28.position.set(0.4338478260869565, -4.105, 0.4023913043478261);
    node_pane_divider_1_28.rotation.set(0.0, -0.2282608695652174, 0.0);
  }
  node_pane_divider_1_28.userData.sculptComponent = {"id": "pane-divider-1", "name": "Curtain-wall vertical glazing mullion 2", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.4338478260869565, -4.105, 0.4023913043478261], "rotation": [0, -0.2282608695652174, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-1", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_1_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_1_28);
  nodes["pane-divider-1"] = node_pane_divider_1_28;
  const mesh_pane_divider_1_28Geometry = endpoint_pane_divider_1_28
    ? new THREE.CylinderGeometry(endpoint_pane_divider_1_28.endRadius, endpoint_pane_divider_1_28.baseRadius, endpoint_pane_divider_1_28.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_1_28) {
    mesh_pane_divider_1_28Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_1_28 = new THREE.Mesh(
    mesh_pane_divider_1_28Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_1_28.name = "Curtain-wall vertical glazing mullion 2";
  if (endpoint_pane_divider_1_28) {
    mesh_pane_divider_1_28.position.copy(endpoint_pane_divider_1_28.midpoint);
    mesh_pane_divider_1_28.quaternion.copy(endpoint_pane_divider_1_28.quaternion);
  }
  mesh_pane_divider_1_28.castShadow = options.castShadow ?? true;
  mesh_pane_divider_1_28.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_1_28.userData.sculptComponent = {"id": "pane-divider-1", "name": "Curtain-wall vertical glazing mullion 2", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.4338478260869565, -4.105, 0.4023913043478261], "rotation": [0, -0.2282608695652174, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-1", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_1_28.add(mesh_pane_divider_1_28);
  meshes["pane-divider-1"] = mesh_pane_divider_1_28;
  colliders["pane-divider-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-1"] ??= [];
  destructionGroups["pane-divider-1"].push(node_pane_divider_1_28);

  const endpoint_pane_divider_2_29 = makeAttachmentEndpoint(null);
  const node_pane_divider_2_29 = new THREE.Group();
  node_pane_divider_2_29.name = "Curtain-wall vertical glazing mullion 3__pivot";
  node_pane_divider_2_29.scale.set(1, 1, 1);
  if (endpoint_pane_divider_2_29) {
    node_pane_divider_2_29.position.copy(endpoint_pane_divider_2_29.start);
    node_pane_divider_2_29.rotation.set(0.0, -0.20652173913043478, 0.0);
  } else {
    node_pane_divider_2_29.position.set(-0.430195652173913, -3.71, 0.3997826086956522);
    node_pane_divider_2_29.rotation.set(0.0, -0.20652173913043478, 0.0);
  }
  node_pane_divider_2_29.userData.sculptComponent = {"id": "pane-divider-2", "name": "Curtain-wall vertical glazing mullion 3", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.430195652173913, -3.71, 0.3997826086956522], "rotation": [0, -0.20652173913043478, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-2", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_2_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_2_29);
  nodes["pane-divider-2"] = node_pane_divider_2_29;
  const mesh_pane_divider_2_29Geometry = endpoint_pane_divider_2_29
    ? new THREE.CylinderGeometry(endpoint_pane_divider_2_29.endRadius, endpoint_pane_divider_2_29.baseRadius, endpoint_pane_divider_2_29.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_2_29) {
    mesh_pane_divider_2_29Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_2_29 = new THREE.Mesh(
    mesh_pane_divider_2_29Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_2_29.name = "Curtain-wall vertical glazing mullion 3";
  if (endpoint_pane_divider_2_29) {
    mesh_pane_divider_2_29.position.copy(endpoint_pane_divider_2_29.midpoint);
    mesh_pane_divider_2_29.quaternion.copy(endpoint_pane_divider_2_29.quaternion);
  }
  mesh_pane_divider_2_29.castShadow = options.castShadow ?? true;
  mesh_pane_divider_2_29.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_2_29.userData.sculptComponent = {"id": "pane-divider-2", "name": "Curtain-wall vertical glazing mullion 3", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.430195652173913, -3.71, 0.3997826086956522], "rotation": [0, -0.20652173913043478, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-2", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_2_29.add(mesh_pane_divider_2_29);
  meshes["pane-divider-2"] = mesh_pane_divider_2_29;
  colliders["pane-divider-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-2"] ??= [];
  destructionGroups["pane-divider-2"].push(node_pane_divider_2_29);

  const endpoint_pane_divider_3_30 = makeAttachmentEndpoint(null);
  const node_pane_divider_3_30 = new THREE.Group();
  node_pane_divider_3_30.name = "Curtain-wall vertical glazing mullion 4__pivot";
  node_pane_divider_3_30.scale.set(1, 1, 1);
  if (endpoint_pane_divider_3_30) {
    node_pane_divider_3_30.position.copy(endpoint_pane_divider_3_30.start);
    node_pane_divider_3_30.rotation.set(0.0, -0.18478260869565216, 0.0);
  } else {
    node_pane_divider_3_30.position.set(0.4265434782608695, -3.315, 0.39717391304347827);
    node_pane_divider_3_30.rotation.set(0.0, -0.18478260869565216, 0.0);
  }
  node_pane_divider_3_30.userData.sculptComponent = {"id": "pane-divider-3", "name": "Curtain-wall vertical glazing mullion 4", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.4265434782608695, -3.315, 0.39717391304347827], "rotation": [0, -0.18478260869565216, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-3", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_3_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_3_30);
  nodes["pane-divider-3"] = node_pane_divider_3_30;
  const mesh_pane_divider_3_30Geometry = endpoint_pane_divider_3_30
    ? new THREE.CylinderGeometry(endpoint_pane_divider_3_30.endRadius, endpoint_pane_divider_3_30.baseRadius, endpoint_pane_divider_3_30.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_3_30) {
    mesh_pane_divider_3_30Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_3_30 = new THREE.Mesh(
    mesh_pane_divider_3_30Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_3_30.name = "Curtain-wall vertical glazing mullion 4";
  if (endpoint_pane_divider_3_30) {
    mesh_pane_divider_3_30.position.copy(endpoint_pane_divider_3_30.midpoint);
    mesh_pane_divider_3_30.quaternion.copy(endpoint_pane_divider_3_30.quaternion);
  }
  mesh_pane_divider_3_30.castShadow = options.castShadow ?? true;
  mesh_pane_divider_3_30.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_3_30.userData.sculptComponent = {"id": "pane-divider-3", "name": "Curtain-wall vertical glazing mullion 4", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.4265434782608695, -3.315, 0.39717391304347827], "rotation": [0, -0.18478260869565216, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-3", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_3_30.add(mesh_pane_divider_3_30);
  meshes["pane-divider-3"] = mesh_pane_divider_3_30;
  colliders["pane-divider-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-3"] ??= [];
  destructionGroups["pane-divider-3"].push(node_pane_divider_3_30);

  const endpoint_pane_divider_4_31 = makeAttachmentEndpoint(null);
  const node_pane_divider_4_31 = new THREE.Group();
  node_pane_divider_4_31.name = "Curtain-wall vertical glazing mullion 5__pivot";
  node_pane_divider_4_31.scale.set(1, 1, 1);
  if (endpoint_pane_divider_4_31) {
    node_pane_divider_4_31.position.copy(endpoint_pane_divider_4_31.start);
    node_pane_divider_4_31.rotation.set(0.0, -0.16304347826086957, 0.0);
  } else {
    node_pane_divider_4_31.position.set(-0.4228913043478261, -2.92, 0.3945652173913044);
    node_pane_divider_4_31.rotation.set(0.0, -0.16304347826086957, 0.0);
  }
  node_pane_divider_4_31.userData.sculptComponent = {"id": "pane-divider-4", "name": "Curtain-wall vertical glazing mullion 5", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4228913043478261, -2.92, 0.3945652173913044], "rotation": [0, -0.16304347826086957, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-4", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_4_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_4_31);
  nodes["pane-divider-4"] = node_pane_divider_4_31;
  const mesh_pane_divider_4_31Geometry = endpoint_pane_divider_4_31
    ? new THREE.CylinderGeometry(endpoint_pane_divider_4_31.endRadius, endpoint_pane_divider_4_31.baseRadius, endpoint_pane_divider_4_31.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_4_31) {
    mesh_pane_divider_4_31Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_4_31 = new THREE.Mesh(
    mesh_pane_divider_4_31Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_4_31.name = "Curtain-wall vertical glazing mullion 5";
  if (endpoint_pane_divider_4_31) {
    mesh_pane_divider_4_31.position.copy(endpoint_pane_divider_4_31.midpoint);
    mesh_pane_divider_4_31.quaternion.copy(endpoint_pane_divider_4_31.quaternion);
  }
  mesh_pane_divider_4_31.castShadow = options.castShadow ?? true;
  mesh_pane_divider_4_31.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_4_31.userData.sculptComponent = {"id": "pane-divider-4", "name": "Curtain-wall vertical glazing mullion 5", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4228913043478261, -2.92, 0.3945652173913044], "rotation": [0, -0.16304347826086957, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-4", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_4_31.add(mesh_pane_divider_4_31);
  meshes["pane-divider-4"] = mesh_pane_divider_4_31;
  colliders["pane-divider-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-4"] ??= [];
  destructionGroups["pane-divider-4"].push(node_pane_divider_4_31);

  const endpoint_pane_divider_5_32 = makeAttachmentEndpoint(null);
  const node_pane_divider_5_32 = new THREE.Group();
  node_pane_divider_5_32.name = "Curtain-wall vertical glazing mullion 6__pivot";
  node_pane_divider_5_32.scale.set(1, 1, 1);
  if (endpoint_pane_divider_5_32) {
    node_pane_divider_5_32.position.copy(endpoint_pane_divider_5_32.start);
    node_pane_divider_5_32.rotation.set(0.0, -0.14130434782608697, 0.0);
  } else {
    node_pane_divider_5_32.position.set(0.4192391304347826, -2.525, 0.3919565217391305);
    node_pane_divider_5_32.rotation.set(0.0, -0.14130434782608697, 0.0);
  }
  node_pane_divider_5_32.userData.sculptComponent = {"id": "pane-divider-5", "name": "Curtain-wall vertical glazing mullion 6", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.4192391304347826, -2.525, 0.3919565217391305], "rotation": [0, -0.14130434782608697, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-5", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_5_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_5_32);
  nodes["pane-divider-5"] = node_pane_divider_5_32;
  const mesh_pane_divider_5_32Geometry = endpoint_pane_divider_5_32
    ? new THREE.CylinderGeometry(endpoint_pane_divider_5_32.endRadius, endpoint_pane_divider_5_32.baseRadius, endpoint_pane_divider_5_32.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_5_32) {
    mesh_pane_divider_5_32Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_5_32 = new THREE.Mesh(
    mesh_pane_divider_5_32Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_5_32.name = "Curtain-wall vertical glazing mullion 6";
  if (endpoint_pane_divider_5_32) {
    mesh_pane_divider_5_32.position.copy(endpoint_pane_divider_5_32.midpoint);
    mesh_pane_divider_5_32.quaternion.copy(endpoint_pane_divider_5_32.quaternion);
  }
  mesh_pane_divider_5_32.castShadow = options.castShadow ?? true;
  mesh_pane_divider_5_32.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_5_32.userData.sculptComponent = {"id": "pane-divider-5", "name": "Curtain-wall vertical glazing mullion 6", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.4192391304347826, -2.525, 0.3919565217391305], "rotation": [0, -0.14130434782608697, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-5", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_5_32.add(mesh_pane_divider_5_32);
  meshes["pane-divider-5"] = mesh_pane_divider_5_32;
  colliders["pane-divider-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-5"] ??= [];
  destructionGroups["pane-divider-5"].push(node_pane_divider_5_32);

  const endpoint_pane_divider_6_33 = makeAttachmentEndpoint(null);
  const node_pane_divider_6_33 = new THREE.Group();
  node_pane_divider_6_33.name = "Curtain-wall vertical glazing mullion 7__pivot";
  node_pane_divider_6_33.scale.set(1, 1, 1);
  if (endpoint_pane_divider_6_33) {
    node_pane_divider_6_33.position.copy(endpoint_pane_divider_6_33.start);
    node_pane_divider_6_33.rotation.set(0.0, -0.11956521739130435, 0.0);
  } else {
    node_pane_divider_6_33.position.set(-0.4155869565217391, -2.13, 0.38934782608695656);
    node_pane_divider_6_33.rotation.set(0.0, -0.11956521739130435, 0.0);
  }
  node_pane_divider_6_33.userData.sculptComponent = {"id": "pane-divider-6", "name": "Curtain-wall vertical glazing mullion 7", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4155869565217391, -2.13, 0.38934782608695656], "rotation": [0, -0.11956521739130435, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-6", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_6_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_6_33);
  nodes["pane-divider-6"] = node_pane_divider_6_33;
  const mesh_pane_divider_6_33Geometry = endpoint_pane_divider_6_33
    ? new THREE.CylinderGeometry(endpoint_pane_divider_6_33.endRadius, endpoint_pane_divider_6_33.baseRadius, endpoint_pane_divider_6_33.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_6_33) {
    mesh_pane_divider_6_33Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_6_33 = new THREE.Mesh(
    mesh_pane_divider_6_33Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_6_33.name = "Curtain-wall vertical glazing mullion 7";
  if (endpoint_pane_divider_6_33) {
    mesh_pane_divider_6_33.position.copy(endpoint_pane_divider_6_33.midpoint);
    mesh_pane_divider_6_33.quaternion.copy(endpoint_pane_divider_6_33.quaternion);
  }
  mesh_pane_divider_6_33.castShadow = options.castShadow ?? true;
  mesh_pane_divider_6_33.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_6_33.userData.sculptComponent = {"id": "pane-divider-6", "name": "Curtain-wall vertical glazing mullion 7", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4155869565217391, -2.13, 0.38934782608695656], "rotation": [0, -0.11956521739130435, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-6", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_6_33.add(mesh_pane_divider_6_33);
  meshes["pane-divider-6"] = mesh_pane_divider_6_33;
  colliders["pane-divider-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-6"] ??= [];
  destructionGroups["pane-divider-6"].push(node_pane_divider_6_33);

  const endpoint_pane_divider_7_34 = makeAttachmentEndpoint(null);
  const node_pane_divider_7_34 = new THREE.Group();
  node_pane_divider_7_34.name = "Curtain-wall vertical glazing mullion 8__pivot";
  node_pane_divider_7_34.scale.set(1, 1, 1);
  if (endpoint_pane_divider_7_34) {
    node_pane_divider_7_34.position.copy(endpoint_pane_divider_7_34.start);
    node_pane_divider_7_34.rotation.set(0.0, -0.09782608695652173, 0.0);
  } else {
    node_pane_divider_7_34.position.set(0.41193478260869565, -1.7349999999999999, 0.38673913043478264);
    node_pane_divider_7_34.rotation.set(0.0, -0.09782608695652173, 0.0);
  }
  node_pane_divider_7_34.userData.sculptComponent = {"id": "pane-divider-7", "name": "Curtain-wall vertical glazing mullion 8", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.41193478260869565, -1.7349999999999999, 0.38673913043478264], "rotation": [0, -0.09782608695652173, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-7", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_7_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_7_34);
  nodes["pane-divider-7"] = node_pane_divider_7_34;
  const mesh_pane_divider_7_34Geometry = endpoint_pane_divider_7_34
    ? new THREE.CylinderGeometry(endpoint_pane_divider_7_34.endRadius, endpoint_pane_divider_7_34.baseRadius, endpoint_pane_divider_7_34.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_7_34) {
    mesh_pane_divider_7_34Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_7_34 = new THREE.Mesh(
    mesh_pane_divider_7_34Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_7_34.name = "Curtain-wall vertical glazing mullion 8";
  if (endpoint_pane_divider_7_34) {
    mesh_pane_divider_7_34.position.copy(endpoint_pane_divider_7_34.midpoint);
    mesh_pane_divider_7_34.quaternion.copy(endpoint_pane_divider_7_34.quaternion);
  }
  mesh_pane_divider_7_34.castShadow = options.castShadow ?? true;
  mesh_pane_divider_7_34.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_7_34.userData.sculptComponent = {"id": "pane-divider-7", "name": "Curtain-wall vertical glazing mullion 8", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.41193478260869565, -1.7349999999999999, 0.38673913043478264], "rotation": [0, -0.09782608695652173, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-7", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_7_34.add(mesh_pane_divider_7_34);
  meshes["pane-divider-7"] = mesh_pane_divider_7_34;
  colliders["pane-divider-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-7"] ??= [];
  destructionGroups["pane-divider-7"].push(node_pane_divider_7_34);

  const endpoint_pane_divider_8_35 = makeAttachmentEndpoint(null);
  const node_pane_divider_8_35 = new THREE.Group();
  node_pane_divider_8_35.name = "Curtain-wall vertical glazing mullion 9__pivot";
  node_pane_divider_8_35.scale.set(1, 1, 1);
  if (endpoint_pane_divider_8_35) {
    node_pane_divider_8_35.position.copy(endpoint_pane_divider_8_35.start);
    node_pane_divider_8_35.rotation.set(0.0, -0.07608695652173914, 0.0);
  } else {
    node_pane_divider_8_35.position.set(-0.40828260869565214, -1.3399999999999999, 0.3841304347826087);
    node_pane_divider_8_35.rotation.set(0.0, -0.07608695652173914, 0.0);
  }
  node_pane_divider_8_35.userData.sculptComponent = {"id": "pane-divider-8", "name": "Curtain-wall vertical glazing mullion 9", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.40828260869565214, -1.3399999999999999, 0.3841304347826087], "rotation": [0, -0.07608695652173914, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-8", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_8_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_8_35);
  nodes["pane-divider-8"] = node_pane_divider_8_35;
  const mesh_pane_divider_8_35Geometry = endpoint_pane_divider_8_35
    ? new THREE.CylinderGeometry(endpoint_pane_divider_8_35.endRadius, endpoint_pane_divider_8_35.baseRadius, endpoint_pane_divider_8_35.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_8_35) {
    mesh_pane_divider_8_35Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_8_35 = new THREE.Mesh(
    mesh_pane_divider_8_35Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_8_35.name = "Curtain-wall vertical glazing mullion 9";
  if (endpoint_pane_divider_8_35) {
    mesh_pane_divider_8_35.position.copy(endpoint_pane_divider_8_35.midpoint);
    mesh_pane_divider_8_35.quaternion.copy(endpoint_pane_divider_8_35.quaternion);
  }
  mesh_pane_divider_8_35.castShadow = options.castShadow ?? true;
  mesh_pane_divider_8_35.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_8_35.userData.sculptComponent = {"id": "pane-divider-8", "name": "Curtain-wall vertical glazing mullion 9", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.40828260869565214, -1.3399999999999999, 0.3841304347826087], "rotation": [0, -0.07608695652173914, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-8", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_8_35.add(mesh_pane_divider_8_35);
  meshes["pane-divider-8"] = mesh_pane_divider_8_35;
  colliders["pane-divider-8"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-8"] ??= [];
  destructionGroups["pane-divider-8"].push(node_pane_divider_8_35);

  const endpoint_pane_divider_9_36 = makeAttachmentEndpoint(null);
  const node_pane_divider_9_36 = new THREE.Group();
  node_pane_divider_9_36.name = "Curtain-wall vertical glazing mullion 10__pivot";
  node_pane_divider_9_36.scale.set(1, 1, 1);
  if (endpoint_pane_divider_9_36) {
    node_pane_divider_9_36.position.copy(endpoint_pane_divider_9_36.start);
    node_pane_divider_9_36.rotation.set(0.0, -0.05434782608695651, 0.0);
  } else {
    node_pane_divider_9_36.position.set(0.4046304347826087, -0.9449999999999998, 0.3815217391304348);
    node_pane_divider_9_36.rotation.set(0.0, -0.05434782608695651, 0.0);
  }
  node_pane_divider_9_36.userData.sculptComponent = {"id": "pane-divider-9", "name": "Curtain-wall vertical glazing mullion 10", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.4046304347826087, -0.9449999999999998, 0.3815217391304348], "rotation": [0, -0.05434782608695651, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-9", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_9_36.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_9_36);
  nodes["pane-divider-9"] = node_pane_divider_9_36;
  const mesh_pane_divider_9_36Geometry = endpoint_pane_divider_9_36
    ? new THREE.CylinderGeometry(endpoint_pane_divider_9_36.endRadius, endpoint_pane_divider_9_36.baseRadius, endpoint_pane_divider_9_36.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_9_36) {
    mesh_pane_divider_9_36Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_9_36 = new THREE.Mesh(
    mesh_pane_divider_9_36Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_9_36.name = "Curtain-wall vertical glazing mullion 10";
  if (endpoint_pane_divider_9_36) {
    mesh_pane_divider_9_36.position.copy(endpoint_pane_divider_9_36.midpoint);
    mesh_pane_divider_9_36.quaternion.copy(endpoint_pane_divider_9_36.quaternion);
  }
  mesh_pane_divider_9_36.castShadow = options.castShadow ?? true;
  mesh_pane_divider_9_36.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_9_36.userData.sculptComponent = {"id": "pane-divider-9", "name": "Curtain-wall vertical glazing mullion 10", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.4046304347826087, -0.9449999999999998, 0.3815217391304348], "rotation": [0, -0.05434782608695651, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-9", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_9_36.add(mesh_pane_divider_9_36);
  meshes["pane-divider-9"] = mesh_pane_divider_9_36;
  colliders["pane-divider-9"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-9"] ??= [];
  destructionGroups["pane-divider-9"].push(node_pane_divider_9_36);

  const endpoint_pane_divider_10_37 = makeAttachmentEndpoint(null);
  const node_pane_divider_10_37 = new THREE.Group();
  node_pane_divider_10_37.name = "Curtain-wall vertical glazing mullion 11__pivot";
  node_pane_divider_10_37.scale.set(1, 1, 1);
  if (endpoint_pane_divider_10_37) {
    node_pane_divider_10_37.position.copy(endpoint_pane_divider_10_37.start);
    node_pane_divider_10_37.rotation.set(0.0, -0.03260869565217392, 0.0);
  } else {
    node_pane_divider_10_37.position.set(-0.4009782608695652, -0.5499999999999998, 0.3789130434782609);
    node_pane_divider_10_37.rotation.set(0.0, -0.03260869565217392, 0.0);
  }
  node_pane_divider_10_37.userData.sculptComponent = {"id": "pane-divider-10", "name": "Curtain-wall vertical glazing mullion 11", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4009782608695652, -0.5499999999999998, 0.3789130434782609], "rotation": [0, -0.03260869565217392, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-10", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_10_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_10_37);
  nodes["pane-divider-10"] = node_pane_divider_10_37;
  const mesh_pane_divider_10_37Geometry = endpoint_pane_divider_10_37
    ? new THREE.CylinderGeometry(endpoint_pane_divider_10_37.endRadius, endpoint_pane_divider_10_37.baseRadius, endpoint_pane_divider_10_37.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_10_37) {
    mesh_pane_divider_10_37Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_10_37 = new THREE.Mesh(
    mesh_pane_divider_10_37Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_10_37.name = "Curtain-wall vertical glazing mullion 11";
  if (endpoint_pane_divider_10_37) {
    mesh_pane_divider_10_37.position.copy(endpoint_pane_divider_10_37.midpoint);
    mesh_pane_divider_10_37.quaternion.copy(endpoint_pane_divider_10_37.quaternion);
  }
  mesh_pane_divider_10_37.castShadow = options.castShadow ?? true;
  mesh_pane_divider_10_37.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_10_37.userData.sculptComponent = {"id": "pane-divider-10", "name": "Curtain-wall vertical glazing mullion 11", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.4009782608695652, -0.5499999999999998, 0.3789130434782609], "rotation": [0, -0.03260869565217392, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-10", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_10_37.add(mesh_pane_divider_10_37);
  meshes["pane-divider-10"] = mesh_pane_divider_10_37;
  colliders["pane-divider-10"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-10"] ??= [];
  destructionGroups["pane-divider-10"].push(node_pane_divider_10_37);

  const endpoint_pane_divider_11_38 = makeAttachmentEndpoint(null);
  const node_pane_divider_11_38 = new THREE.Group();
  node_pane_divider_11_38.name = "Curtain-wall vertical glazing mullion 12__pivot";
  node_pane_divider_11_38.scale.set(1, 1, 1);
  if (endpoint_pane_divider_11_38) {
    node_pane_divider_11_38.position.copy(endpoint_pane_divider_11_38.start);
    node_pane_divider_11_38.rotation.set(0.0, -0.010869565217391297, 0.0);
  } else {
    node_pane_divider_11_38.position.set(0.39732608695652166, -0.15499999999999936, 0.37630434782608696);
    node_pane_divider_11_38.rotation.set(0.0, -0.010869565217391297, 0.0);
  }
  node_pane_divider_11_38.userData.sculptComponent = {"id": "pane-divider-11", "name": "Curtain-wall vertical glazing mullion 12", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.39732608695652166, -0.15499999999999936, 0.37630434782608696], "rotation": [0, -0.010869565217391297, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-11", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_11_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_11_38);
  nodes["pane-divider-11"] = node_pane_divider_11_38;
  const mesh_pane_divider_11_38Geometry = endpoint_pane_divider_11_38
    ? new THREE.CylinderGeometry(endpoint_pane_divider_11_38.endRadius, endpoint_pane_divider_11_38.baseRadius, endpoint_pane_divider_11_38.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_11_38) {
    mesh_pane_divider_11_38Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_11_38 = new THREE.Mesh(
    mesh_pane_divider_11_38Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_11_38.name = "Curtain-wall vertical glazing mullion 12";
  if (endpoint_pane_divider_11_38) {
    mesh_pane_divider_11_38.position.copy(endpoint_pane_divider_11_38.midpoint);
    mesh_pane_divider_11_38.quaternion.copy(endpoint_pane_divider_11_38.quaternion);
  }
  mesh_pane_divider_11_38.castShadow = options.castShadow ?? true;
  mesh_pane_divider_11_38.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_11_38.userData.sculptComponent = {"id": "pane-divider-11", "name": "Curtain-wall vertical glazing mullion 12", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.39732608695652166, -0.15499999999999936, 0.37630434782608696], "rotation": [0, -0.010869565217391297, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-11", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_11_38.add(mesh_pane_divider_11_38);
  meshes["pane-divider-11"] = mesh_pane_divider_11_38;
  colliders["pane-divider-11"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-11"] ??= [];
  destructionGroups["pane-divider-11"].push(node_pane_divider_11_38);

  const endpoint_pane_divider_12_39 = makeAttachmentEndpoint(null);
  const node_pane_divider_12_39 = new THREE.Group();
  node_pane_divider_12_39.name = "Curtain-wall vertical glazing mullion 13__pivot";
  node_pane_divider_12_39.scale.set(1, 1, 1);
  if (endpoint_pane_divider_12_39) {
    node_pane_divider_12_39.position.copy(endpoint_pane_divider_12_39.start);
    node_pane_divider_12_39.rotation.set(0.0, 0.010869565217391297, 0.0);
  } else {
    node_pane_divider_12_39.position.set(-0.39367391304347826, 0.2400000000000002, 0.3736956521739131);
    node_pane_divider_12_39.rotation.set(0.0, 0.010869565217391297, 0.0);
  }
  node_pane_divider_12_39.userData.sculptComponent = {"id": "pane-divider-12", "name": "Curtain-wall vertical glazing mullion 13", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.39367391304347826, 0.2400000000000002, 0.3736956521739131], "rotation": [0, 0.010869565217391297, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-12", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-12", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_12_39.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-12", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_12_39);
  nodes["pane-divider-12"] = node_pane_divider_12_39;
  const mesh_pane_divider_12_39Geometry = endpoint_pane_divider_12_39
    ? new THREE.CylinderGeometry(endpoint_pane_divider_12_39.endRadius, endpoint_pane_divider_12_39.baseRadius, endpoint_pane_divider_12_39.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_12_39) {
    mesh_pane_divider_12_39Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_12_39 = new THREE.Mesh(
    mesh_pane_divider_12_39Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_12_39.name = "Curtain-wall vertical glazing mullion 13";
  if (endpoint_pane_divider_12_39) {
    mesh_pane_divider_12_39.position.copy(endpoint_pane_divider_12_39.midpoint);
    mesh_pane_divider_12_39.quaternion.copy(endpoint_pane_divider_12_39.quaternion);
  }
  mesh_pane_divider_12_39.castShadow = options.castShadow ?? true;
  mesh_pane_divider_12_39.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_12_39.userData.sculptComponent = {"id": "pane-divider-12", "name": "Curtain-wall vertical glazing mullion 13", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.39367391304347826, 0.2400000000000002, 0.3736956521739131], "rotation": [0, 0.010869565217391297, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-12", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-12", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_12_39.add(mesh_pane_divider_12_39);
  meshes["pane-divider-12"] = mesh_pane_divider_12_39;
  colliders["pane-divider-12"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-12"] ??= [];
  destructionGroups["pane-divider-12"].push(node_pane_divider_12_39);

  const endpoint_pane_divider_13_40 = makeAttachmentEndpoint(null);
  const node_pane_divider_13_40 = new THREE.Group();
  node_pane_divider_13_40.name = "Curtain-wall vertical glazing mullion 14__pivot";
  node_pane_divider_13_40.scale.set(1, 1, 1);
  if (endpoint_pane_divider_13_40) {
    node_pane_divider_13_40.position.copy(endpoint_pane_divider_13_40.start);
    node_pane_divider_13_40.rotation.set(0.0, 0.03260869565217389, 0.0);
  } else {
    node_pane_divider_13_40.position.set(0.3900217391304348, 0.6349999999999998, 0.3710869565217392);
    node_pane_divider_13_40.rotation.set(0.0, 0.03260869565217389, 0.0);
  }
  node_pane_divider_13_40.userData.sculptComponent = {"id": "pane-divider-13", "name": "Curtain-wall vertical glazing mullion 14", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.3900217391304348, 0.6349999999999998, 0.3710869565217392], "rotation": [0, 0.03260869565217389, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-13", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-13", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_13_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-13", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_13_40);
  nodes["pane-divider-13"] = node_pane_divider_13_40;
  const mesh_pane_divider_13_40Geometry = endpoint_pane_divider_13_40
    ? new THREE.CylinderGeometry(endpoint_pane_divider_13_40.endRadius, endpoint_pane_divider_13_40.baseRadius, endpoint_pane_divider_13_40.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_13_40) {
    mesh_pane_divider_13_40Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_13_40 = new THREE.Mesh(
    mesh_pane_divider_13_40Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_13_40.name = "Curtain-wall vertical glazing mullion 14";
  if (endpoint_pane_divider_13_40) {
    mesh_pane_divider_13_40.position.copy(endpoint_pane_divider_13_40.midpoint);
    mesh_pane_divider_13_40.quaternion.copy(endpoint_pane_divider_13_40.quaternion);
  }
  mesh_pane_divider_13_40.castShadow = options.castShadow ?? true;
  mesh_pane_divider_13_40.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_13_40.userData.sculptComponent = {"id": "pane-divider-13", "name": "Curtain-wall vertical glazing mullion 14", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.3900217391304348, 0.6349999999999998, 0.3710869565217392], "rotation": [0, 0.03260869565217389, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-13", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-13", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_13_40.add(mesh_pane_divider_13_40);
  meshes["pane-divider-13"] = mesh_pane_divider_13_40;
  colliders["pane-divider-13"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-13"] ??= [];
  destructionGroups["pane-divider-13"].push(node_pane_divider_13_40);

  const endpoint_pane_divider_14_41 = makeAttachmentEndpoint(null);
  const node_pane_divider_14_41 = new THREE.Group();
  node_pane_divider_14_41.name = "Curtain-wall vertical glazing mullion 15__pivot";
  node_pane_divider_14_41.scale.set(1, 1, 1);
  if (endpoint_pane_divider_14_41) {
    node_pane_divider_14_41.position.copy(endpoint_pane_divider_14_41.start);
    node_pane_divider_14_41.rotation.set(0.0, 0.05434782608695654, 0.0);
  } else {
    node_pane_divider_14_41.position.set(-0.3863695652173913, 1.0300000000000002, 0.36847826086956526);
    node_pane_divider_14_41.rotation.set(0.0, 0.05434782608695654, 0.0);
  }
  node_pane_divider_14_41.userData.sculptComponent = {"id": "pane-divider-14", "name": "Curtain-wall vertical glazing mullion 15", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.3863695652173913, 1.0300000000000002, 0.36847826086956526], "rotation": [0, 0.05434782608695654, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-14", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-14", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_14_41.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-14", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_14_41);
  nodes["pane-divider-14"] = node_pane_divider_14_41;
  const mesh_pane_divider_14_41Geometry = endpoint_pane_divider_14_41
    ? new THREE.CylinderGeometry(endpoint_pane_divider_14_41.endRadius, endpoint_pane_divider_14_41.baseRadius, endpoint_pane_divider_14_41.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_14_41) {
    mesh_pane_divider_14_41Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_14_41 = new THREE.Mesh(
    mesh_pane_divider_14_41Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_14_41.name = "Curtain-wall vertical glazing mullion 15";
  if (endpoint_pane_divider_14_41) {
    mesh_pane_divider_14_41.position.copy(endpoint_pane_divider_14_41.midpoint);
    mesh_pane_divider_14_41.quaternion.copy(endpoint_pane_divider_14_41.quaternion);
  }
  mesh_pane_divider_14_41.castShadow = options.castShadow ?? true;
  mesh_pane_divider_14_41.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_14_41.userData.sculptComponent = {"id": "pane-divider-14", "name": "Curtain-wall vertical glazing mullion 15", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.3863695652173913, 1.0300000000000002, 0.36847826086956526], "rotation": [0, 0.05434782608695654, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-14", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-14", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_14_41.add(mesh_pane_divider_14_41);
  meshes["pane-divider-14"] = mesh_pane_divider_14_41;
  colliders["pane-divider-14"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-14"] ??= [];
  destructionGroups["pane-divider-14"].push(node_pane_divider_14_41);

  const endpoint_pane_divider_15_42 = makeAttachmentEndpoint(null);
  const node_pane_divider_15_42 = new THREE.Group();
  node_pane_divider_15_42.name = "Curtain-wall vertical glazing mullion 16__pivot";
  node_pane_divider_15_42.scale.set(1, 1, 1);
  if (endpoint_pane_divider_15_42) {
    node_pane_divider_15_42.position.copy(endpoint_pane_divider_15_42.start);
    node_pane_divider_15_42.rotation.set(0.0, 0.07608695652173914, 0.0);
  } else {
    node_pane_divider_15_42.position.set(0.3827173913043478, 1.4250000000000007, 0.36586956521739133);
    node_pane_divider_15_42.rotation.set(0.0, 0.07608695652173914, 0.0);
  }
  node_pane_divider_15_42.userData.sculptComponent = {"id": "pane-divider-15", "name": "Curtain-wall vertical glazing mullion 16", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.3827173913043478, 1.4250000000000007, 0.36586956521739133], "rotation": [0, 0.07608695652173914, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-15", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-15", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_15_42.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-15", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_15_42);
  nodes["pane-divider-15"] = node_pane_divider_15_42;
  const mesh_pane_divider_15_42Geometry = endpoint_pane_divider_15_42
    ? new THREE.CylinderGeometry(endpoint_pane_divider_15_42.endRadius, endpoint_pane_divider_15_42.baseRadius, endpoint_pane_divider_15_42.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_15_42) {
    mesh_pane_divider_15_42Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_15_42 = new THREE.Mesh(
    mesh_pane_divider_15_42Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_15_42.name = "Curtain-wall vertical glazing mullion 16";
  if (endpoint_pane_divider_15_42) {
    mesh_pane_divider_15_42.position.copy(endpoint_pane_divider_15_42.midpoint);
    mesh_pane_divider_15_42.quaternion.copy(endpoint_pane_divider_15_42.quaternion);
  }
  mesh_pane_divider_15_42.castShadow = options.castShadow ?? true;
  mesh_pane_divider_15_42.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_15_42.userData.sculptComponent = {"id": "pane-divider-15", "name": "Curtain-wall vertical glazing mullion 16", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.3827173913043478, 1.4250000000000007, 0.36586956521739133], "rotation": [0, 0.07608695652173914, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-15", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-15", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_15_42.add(mesh_pane_divider_15_42);
  meshes["pane-divider-15"] = mesh_pane_divider_15_42;
  colliders["pane-divider-15"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-15"] ??= [];
  destructionGroups["pane-divider-15"].push(node_pane_divider_15_42);

  const endpoint_pane_divider_16_43 = makeAttachmentEndpoint(null);
  const node_pane_divider_16_43 = new THREE.Group();
  node_pane_divider_16_43.name = "Curtain-wall vertical glazing mullion 17__pivot";
  node_pane_divider_16_43.scale.set(1, 1, 1);
  if (endpoint_pane_divider_16_43) {
    node_pane_divider_16_43.position.copy(endpoint_pane_divider_16_43.start);
    node_pane_divider_16_43.rotation.set(0.0, 0.09782608695652173, 0.0);
  } else {
    node_pane_divider_16_43.position.set(-0.37906521739130433, 1.8200000000000003, 0.3632608695652174);
    node_pane_divider_16_43.rotation.set(0.0, 0.09782608695652173, 0.0);
  }
  node_pane_divider_16_43.userData.sculptComponent = {"id": "pane-divider-16", "name": "Curtain-wall vertical glazing mullion 17", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.37906521739130433, 1.8200000000000003, 0.3632608695652174], "rotation": [0, 0.09782608695652173, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-16", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-16", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_16_43.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-16", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_16_43);
  nodes["pane-divider-16"] = node_pane_divider_16_43;
  const mesh_pane_divider_16_43Geometry = endpoint_pane_divider_16_43
    ? new THREE.CylinderGeometry(endpoint_pane_divider_16_43.endRadius, endpoint_pane_divider_16_43.baseRadius, endpoint_pane_divider_16_43.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_16_43) {
    mesh_pane_divider_16_43Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_16_43 = new THREE.Mesh(
    mesh_pane_divider_16_43Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_16_43.name = "Curtain-wall vertical glazing mullion 17";
  if (endpoint_pane_divider_16_43) {
    mesh_pane_divider_16_43.position.copy(endpoint_pane_divider_16_43.midpoint);
    mesh_pane_divider_16_43.quaternion.copy(endpoint_pane_divider_16_43.quaternion);
  }
  mesh_pane_divider_16_43.castShadow = options.castShadow ?? true;
  mesh_pane_divider_16_43.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_16_43.userData.sculptComponent = {"id": "pane-divider-16", "name": "Curtain-wall vertical glazing mullion 17", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.37906521739130433, 1.8200000000000003, 0.3632608695652174], "rotation": [0, 0.09782608695652173, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-16", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-16", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_16_43.add(mesh_pane_divider_16_43);
  meshes["pane-divider-16"] = mesh_pane_divider_16_43;
  colliders["pane-divider-16"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-16"] ??= [];
  destructionGroups["pane-divider-16"].push(node_pane_divider_16_43);

  const endpoint_pane_divider_17_44 = makeAttachmentEndpoint(null);
  const node_pane_divider_17_44 = new THREE.Group();
  node_pane_divider_17_44.name = "Curtain-wall vertical glazing mullion 18__pivot";
  node_pane_divider_17_44.scale.set(1, 1, 1);
  if (endpoint_pane_divider_17_44) {
    node_pane_divider_17_44.position.copy(endpoint_pane_divider_17_44.start);
    node_pane_divider_17_44.rotation.set(0.0, 0.11956521739130432, 0.0);
  } else {
    node_pane_divider_17_44.position.set(0.3754130434782608, 2.215, 0.3606521739130435);
    node_pane_divider_17_44.rotation.set(0.0, 0.11956521739130432, 0.0);
  }
  node_pane_divider_17_44.userData.sculptComponent = {"id": "pane-divider-17", "name": "Curtain-wall vertical glazing mullion 18", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.3754130434782608, 2.215, 0.3606521739130435], "rotation": [0, 0.11956521739130432, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-17", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-17", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_17_44.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-17", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_17_44);
  nodes["pane-divider-17"] = node_pane_divider_17_44;
  const mesh_pane_divider_17_44Geometry = endpoint_pane_divider_17_44
    ? new THREE.CylinderGeometry(endpoint_pane_divider_17_44.endRadius, endpoint_pane_divider_17_44.baseRadius, endpoint_pane_divider_17_44.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_17_44) {
    mesh_pane_divider_17_44Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_17_44 = new THREE.Mesh(
    mesh_pane_divider_17_44Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_17_44.name = "Curtain-wall vertical glazing mullion 18";
  if (endpoint_pane_divider_17_44) {
    mesh_pane_divider_17_44.position.copy(endpoint_pane_divider_17_44.midpoint);
    mesh_pane_divider_17_44.quaternion.copy(endpoint_pane_divider_17_44.quaternion);
  }
  mesh_pane_divider_17_44.castShadow = options.castShadow ?? true;
  mesh_pane_divider_17_44.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_17_44.userData.sculptComponent = {"id": "pane-divider-17", "name": "Curtain-wall vertical glazing mullion 18", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.3754130434782608, 2.215, 0.3606521739130435], "rotation": [0, 0.11956521739130432, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-17", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-17", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_17_44.add(mesh_pane_divider_17_44);
  meshes["pane-divider-17"] = mesh_pane_divider_17_44;
  colliders["pane-divider-17"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-17"] ??= [];
  destructionGroups["pane-divider-17"].push(node_pane_divider_17_44);

  const endpoint_pane_divider_18_45 = makeAttachmentEndpoint(null);
  const node_pane_divider_18_45 = new THREE.Group();
  node_pane_divider_18_45.name = "Curtain-wall vertical glazing mullion 19__pivot";
  node_pane_divider_18_45.scale.set(1, 1, 1);
  if (endpoint_pane_divider_18_45) {
    node_pane_divider_18_45.position.copy(endpoint_pane_divider_18_45.start);
    node_pane_divider_18_45.rotation.set(0.0, 0.14130434782608697, 0.0);
  } else {
    node_pane_divider_18_45.position.set(-0.37176086956521737, 2.6100000000000003, 0.3580434782608696);
    node_pane_divider_18_45.rotation.set(0.0, 0.14130434782608697, 0.0);
  }
  node_pane_divider_18_45.userData.sculptComponent = {"id": "pane-divider-18", "name": "Curtain-wall vertical glazing mullion 19", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.37176086956521737, 2.6100000000000003, 0.3580434782608696], "rotation": [0, 0.14130434782608697, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-18", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-18", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_18_45.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-18", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_18_45);
  nodes["pane-divider-18"] = node_pane_divider_18_45;
  const mesh_pane_divider_18_45Geometry = endpoint_pane_divider_18_45
    ? new THREE.CylinderGeometry(endpoint_pane_divider_18_45.endRadius, endpoint_pane_divider_18_45.baseRadius, endpoint_pane_divider_18_45.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_18_45) {
    mesh_pane_divider_18_45Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_18_45 = new THREE.Mesh(
    mesh_pane_divider_18_45Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_18_45.name = "Curtain-wall vertical glazing mullion 19";
  if (endpoint_pane_divider_18_45) {
    mesh_pane_divider_18_45.position.copy(endpoint_pane_divider_18_45.midpoint);
    mesh_pane_divider_18_45.quaternion.copy(endpoint_pane_divider_18_45.quaternion);
  }
  mesh_pane_divider_18_45.castShadow = options.castShadow ?? true;
  mesh_pane_divider_18_45.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_18_45.userData.sculptComponent = {"id": "pane-divider-18", "name": "Curtain-wall vertical glazing mullion 19", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.37176086956521737, 2.6100000000000003, 0.3580434782608696], "rotation": [0, 0.14130434782608697, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-18", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-18", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_18_45.add(mesh_pane_divider_18_45);
  meshes["pane-divider-18"] = mesh_pane_divider_18_45;
  colliders["pane-divider-18"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-18"] ??= [];
  destructionGroups["pane-divider-18"].push(node_pane_divider_18_45);

  const endpoint_pane_divider_19_46 = makeAttachmentEndpoint(null);
  const node_pane_divider_19_46 = new THREE.Group();
  node_pane_divider_19_46.name = "Curtain-wall vertical glazing mullion 20__pivot";
  node_pane_divider_19_46.scale.set(1, 1, 1);
  if (endpoint_pane_divider_19_46) {
    node_pane_divider_19_46.position.copy(endpoint_pane_divider_19_46.start);
    node_pane_divider_19_46.rotation.set(0.0, 0.16304347826086957, 0.0);
  } else {
    node_pane_divider_19_46.position.set(0.36810869565217386, 3.005000000000001, 0.35543478260869565);
    node_pane_divider_19_46.rotation.set(0.0, 0.16304347826086957, 0.0);
  }
  node_pane_divider_19_46.userData.sculptComponent = {"id": "pane-divider-19", "name": "Curtain-wall vertical glazing mullion 20", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.36810869565217386, 3.005000000000001, 0.35543478260869565], "rotation": [0, 0.16304347826086957, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-19", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-19", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_19_46.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-19", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_19_46);
  nodes["pane-divider-19"] = node_pane_divider_19_46;
  const mesh_pane_divider_19_46Geometry = endpoint_pane_divider_19_46
    ? new THREE.CylinderGeometry(endpoint_pane_divider_19_46.endRadius, endpoint_pane_divider_19_46.baseRadius, endpoint_pane_divider_19_46.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_19_46) {
    mesh_pane_divider_19_46Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_19_46 = new THREE.Mesh(
    mesh_pane_divider_19_46Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_19_46.name = "Curtain-wall vertical glazing mullion 20";
  if (endpoint_pane_divider_19_46) {
    mesh_pane_divider_19_46.position.copy(endpoint_pane_divider_19_46.midpoint);
    mesh_pane_divider_19_46.quaternion.copy(endpoint_pane_divider_19_46.quaternion);
  }
  mesh_pane_divider_19_46.castShadow = options.castShadow ?? true;
  mesh_pane_divider_19_46.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_19_46.userData.sculptComponent = {"id": "pane-divider-19", "name": "Curtain-wall vertical glazing mullion 20", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.36810869565217386, 3.005000000000001, 0.35543478260869565], "rotation": [0, 0.16304347826086957, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-19", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-19", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_19_46.add(mesh_pane_divider_19_46);
  meshes["pane-divider-19"] = mesh_pane_divider_19_46;
  colliders["pane-divider-19"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-19"] ??= [];
  destructionGroups["pane-divider-19"].push(node_pane_divider_19_46);

  const endpoint_pane_divider_20_47 = makeAttachmentEndpoint(null);
  const node_pane_divider_20_47 = new THREE.Group();
  node_pane_divider_20_47.name = "Curtain-wall vertical glazing mullion 21__pivot";
  node_pane_divider_20_47.scale.set(1, 1, 1);
  if (endpoint_pane_divider_20_47) {
    node_pane_divider_20_47.position.copy(endpoint_pane_divider_20_47.start);
    node_pane_divider_20_47.rotation.set(0.0, 0.18478260869565216, 0.0);
  } else {
    node_pane_divider_20_47.position.set(-0.36445652173913046, 3.4000000000000004, 0.3528260869565218);
    node_pane_divider_20_47.rotation.set(0.0, 0.18478260869565216, 0.0);
  }
  node_pane_divider_20_47.userData.sculptComponent = {"id": "pane-divider-20", "name": "Curtain-wall vertical glazing mullion 21", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.36445652173913046, 3.4000000000000004, 0.3528260869565218], "rotation": [0, 0.18478260869565216, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-20", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-20", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_20_47.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-20", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_20_47);
  nodes["pane-divider-20"] = node_pane_divider_20_47;
  const mesh_pane_divider_20_47Geometry = endpoint_pane_divider_20_47
    ? new THREE.CylinderGeometry(endpoint_pane_divider_20_47.endRadius, endpoint_pane_divider_20_47.baseRadius, endpoint_pane_divider_20_47.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_20_47) {
    mesh_pane_divider_20_47Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_20_47 = new THREE.Mesh(
    mesh_pane_divider_20_47Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_20_47.name = "Curtain-wall vertical glazing mullion 21";
  if (endpoint_pane_divider_20_47) {
    mesh_pane_divider_20_47.position.copy(endpoint_pane_divider_20_47.midpoint);
    mesh_pane_divider_20_47.quaternion.copy(endpoint_pane_divider_20_47.quaternion);
  }
  mesh_pane_divider_20_47.castShadow = options.castShadow ?? true;
  mesh_pane_divider_20_47.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_20_47.userData.sculptComponent = {"id": "pane-divider-20", "name": "Curtain-wall vertical glazing mullion 21", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.36445652173913046, 3.4000000000000004, 0.3528260869565218], "rotation": [0, 0.18478260869565216, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-20", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-20", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_20_47.add(mesh_pane_divider_20_47);
  meshes["pane-divider-20"] = mesh_pane_divider_20_47;
  colliders["pane-divider-20"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-20"] ??= [];
  destructionGroups["pane-divider-20"].push(node_pane_divider_20_47);

  const endpoint_pane_divider_21_48 = makeAttachmentEndpoint(null);
  const node_pane_divider_21_48 = new THREE.Group();
  node_pane_divider_21_48.name = "Curtain-wall vertical glazing mullion 22__pivot";
  node_pane_divider_21_48.scale.set(1, 1, 1);
  if (endpoint_pane_divider_21_48) {
    node_pane_divider_21_48.position.copy(endpoint_pane_divider_21_48.start);
    node_pane_divider_21_48.rotation.set(0.0, 0.20652173913043476, 0.0);
  } else {
    node_pane_divider_21_48.position.set(0.36080434782608695, 3.795, 0.35021739130434787);
    node_pane_divider_21_48.rotation.set(0.0, 0.20652173913043476, 0.0);
  }
  node_pane_divider_21_48.userData.sculptComponent = {"id": "pane-divider-21", "name": "Curtain-wall vertical glazing mullion 22", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.36080434782608695, 3.795, 0.35021739130434787], "rotation": [0, 0.20652173913043476, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-21", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-21", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_21_48.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-21", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_21_48);
  nodes["pane-divider-21"] = node_pane_divider_21_48;
  const mesh_pane_divider_21_48Geometry = endpoint_pane_divider_21_48
    ? new THREE.CylinderGeometry(endpoint_pane_divider_21_48.endRadius, endpoint_pane_divider_21_48.baseRadius, endpoint_pane_divider_21_48.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_21_48) {
    mesh_pane_divider_21_48Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_21_48 = new THREE.Mesh(
    mesh_pane_divider_21_48Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_21_48.name = "Curtain-wall vertical glazing mullion 22";
  if (endpoint_pane_divider_21_48) {
    mesh_pane_divider_21_48.position.copy(endpoint_pane_divider_21_48.midpoint);
    mesh_pane_divider_21_48.quaternion.copy(endpoint_pane_divider_21_48.quaternion);
  }
  mesh_pane_divider_21_48.castShadow = options.castShadow ?? true;
  mesh_pane_divider_21_48.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_21_48.userData.sculptComponent = {"id": "pane-divider-21", "name": "Curtain-wall vertical glazing mullion 22", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.36080434782608695, 3.795, 0.35021739130434787], "rotation": [0, 0.20652173913043476, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-21", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-21", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_21_48.add(mesh_pane_divider_21_48);
  meshes["pane-divider-21"] = mesh_pane_divider_21_48;
  colliders["pane-divider-21"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-21"] ??= [];
  destructionGroups["pane-divider-21"].push(node_pane_divider_21_48);

  const endpoint_pane_divider_22_49 = makeAttachmentEndpoint(null);
  const node_pane_divider_22_49 = new THREE.Group();
  node_pane_divider_22_49.name = "Curtain-wall vertical glazing mullion 23__pivot";
  node_pane_divider_22_49.scale.set(1, 1, 1);
  if (endpoint_pane_divider_22_49) {
    node_pane_divider_22_49.position.copy(endpoint_pane_divider_22_49.start);
    node_pane_divider_22_49.rotation.set(0.0, 0.2282608695652174, 0.0);
  } else {
    node_pane_divider_22_49.position.set(-0.3571521739130435, 4.190000000000001, 0.34760869565217395);
    node_pane_divider_22_49.rotation.set(0.0, 0.2282608695652174, 0.0);
  }
  node_pane_divider_22_49.userData.sculptComponent = {"id": "pane-divider-22", "name": "Curtain-wall vertical glazing mullion 23", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.3571521739130435, 4.190000000000001, 0.34760869565217395], "rotation": [0, 0.2282608695652174, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-22", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-22", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_22_49.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-22", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_22_49);
  nodes["pane-divider-22"] = node_pane_divider_22_49;
  const mesh_pane_divider_22_49Geometry = endpoint_pane_divider_22_49
    ? new THREE.CylinderGeometry(endpoint_pane_divider_22_49.endRadius, endpoint_pane_divider_22_49.baseRadius, endpoint_pane_divider_22_49.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_22_49) {
    mesh_pane_divider_22_49Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_22_49 = new THREE.Mesh(
    mesh_pane_divider_22_49Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_22_49.name = "Curtain-wall vertical glazing mullion 23";
  if (endpoint_pane_divider_22_49) {
    mesh_pane_divider_22_49.position.copy(endpoint_pane_divider_22_49.midpoint);
    mesh_pane_divider_22_49.quaternion.copy(endpoint_pane_divider_22_49.quaternion);
  }
  mesh_pane_divider_22_49.castShadow = options.castShadow ?? true;
  mesh_pane_divider_22_49.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_22_49.userData.sculptComponent = {"id": "pane-divider-22", "name": "Curtain-wall vertical glazing mullion 23", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.3571521739130435, 4.190000000000001, 0.34760869565217395], "rotation": [0, 0.2282608695652174, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-22", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-22", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_22_49.add(mesh_pane_divider_22_49);
  meshes["pane-divider-22"] = mesh_pane_divider_22_49;
  colliders["pane-divider-22"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-22"] ??= [];
  destructionGroups["pane-divider-22"].push(node_pane_divider_22_49);

  const endpoint_pane_divider_23_50 = makeAttachmentEndpoint(null);
  const node_pane_divider_23_50 = new THREE.Group();
  node_pane_divider_23_50.name = "Curtain-wall vertical glazing mullion 24__pivot";
  node_pane_divider_23_50.scale.set(1, 1, 1);
  if (endpoint_pane_divider_23_50) {
    node_pane_divider_23_50.position.copy(endpoint_pane_divider_23_50.start);
    node_pane_divider_23_50.rotation.set(0.0, 0.25, 0.0);
  } else {
    node_pane_divider_23_50.position.set(0.3535, 4.585000000000001, 0.34500000000000003);
    node_pane_divider_23_50.rotation.set(0.0, 0.25, 0.0);
  }
  node_pane_divider_23_50.userData.sculptComponent = {"id": "pane-divider-23", "name": "Curtain-wall vertical glazing mullion 24", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.3535, 4.585000000000001, 0.34500000000000003], "rotation": [0, 0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-23", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-23", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_23_50.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-23", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pane_divider_23_50);
  nodes["pane-divider-23"] = node_pane_divider_23_50;
  const mesh_pane_divider_23_50Geometry = endpoint_pane_divider_23_50
    ? new THREE.CylinderGeometry(endpoint_pane_divider_23_50.endRadius, endpoint_pane_divider_23_50.baseRadius, endpoint_pane_divider_23_50.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pane_divider_23_50) {
    mesh_pane_divider_23_50Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pane_divider_23_50 = new THREE.Mesh(
    mesh_pane_divider_23_50Geometry,
    materialMap["curtain-wall-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pane_divider_23_50.name = "Curtain-wall vertical glazing mullion 24";
  if (endpoint_pane_divider_23_50) {
    mesh_pane_divider_23_50.position.copy(endpoint_pane_divider_23_50.midpoint);
    mesh_pane_divider_23_50.quaternion.copy(endpoint_pane_divider_23_50.quaternion);
  }
  mesh_pane_divider_23_50.castShadow = options.castShadow ?? true;
  mesh_pane_divider_23_50.receiveShadow = options.receiveShadow ?? true;
  mesh_pane_divider_23_50.userData.sculptComponent = {"id": "pane-divider-23", "name": "Curtain-wall vertical glazing mullion 24", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Image shows angular continuous glass/steel clad building surfaces with planar rectangular mullions", "geometryDescriptor": {"topologyIntent": "flat glazed curtainwall surface with real thickness", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.023, "height": 0.38, "depth": 0.033, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.3535, 4.585000000000001, 0.34500000000000003], "rotation": [0, 0.25, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pane-divider-23", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "curtain-wall-metal", "materialLayers": ["curtain-wall-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-edge-23", "kind": "ridge", "notes": "narrow metal glazing mullion"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 70, 86, 1.0)", "secondaryAlbedo": "rgba(51, 70, 86, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object"], "reason": "Reference image contains this region's identifiable PBR surface"}};
  node_pane_divider_23_50.add(mesh_pane_divider_23_50);
  meshes["pane-divider-23"] = mesh_pane_divider_23_50;
  colliders["pane-divider-23"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.023, 0.38, 0.033], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["pane-divider-23"] ??= [];
  destructionGroups["pane-divider-23"].push(node_pane_divider_23_50);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Provisional geometry/material demonstration using compressed reference image; independent PBR extraction is not represented as completed or certified."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createTwistingGlassSkyscraperLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Twisting Glass Skyscraper look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"type": "key light", "direction": [-0.6, 1, 0.5], "color": "#ffffff", "intensity": 2.3, "notes": "High diffuse white studio sky"}, {"type": "fill light", "direction": [0.7, 0.5, 0.2], "color": "#d6e9ff", "intensity": 1.3, "notes": "Soft facade fill"}, {"type": "rim environment light", "color": "#e9f2ff", "intensity": 1, "exposure": 1.1, "toneMapping": "ACESFilmic", "contactShadow": "Soft gray ground shadow and contact shadow on plinth"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Provisional geometry/material demonstration using compressed reference image; independent PBR extraction is not represented as completed or certified."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createTwistingGlassSkyscraperEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameTwistingGlassSkyscraperCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createTwistingGlassSkyscraperPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureTwistingGlassSkyscraperRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createTwistingGlassSkyscraperInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
