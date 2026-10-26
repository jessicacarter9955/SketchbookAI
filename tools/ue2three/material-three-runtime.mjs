/**
 * Opt-in Three.js PBR adapter for source-witnessed Unreal material expressions.
 * Lighting, textures, instances, vertex behavior and visual 1:1 are NOT
 * certified. Unsupported source roots fail closed instead of being guessed.
 */
import {Vector4} from 'three';

const INCLUDES = Object.freeze({
  BaseColor: 'color_fragment',
  Roughness: 'roughnessmap_fragment',
  Metallic: 'metalnessmap_fragment',
  EmissiveColor: 'emissivemap_fragment',
  Opacity: 'alphamap_fragment'
});
const ASSIGN = Object.freeze({
  BaseColor: x => 'diffuseColor.rgb = ' + x + ';',
  Roughness: x => 'roughnessFactor = clamp(' + x + ', 0.0, 1.0);',
  Metallic: x => 'metalnessFactor = clamp(' + x + ', 0.0, 1.0);',
  EmissiveColor: x => 'totalEmissiveRadiance = ' + x + ';',
  Opacity: x => 'diffuseColor.a = clamp(' + x + ', 0.0, 1.0);'
});

function validate(lowering) {
  if (!lowering || lowering.schema_version !== 1 || lowering.shader_execution !== 'not_integrated') {
    throw new Error('Requires source-witnessed GLSL lowering v1');
  }
  const roots = lowering.translated_roots, blocked = lowering.blocked_roots;
  if (!roots || !blocked || typeof roots !== 'object' || typeof blocked !== 'object') {
    throw new Error('Incomplete material graph status');
  }
  if (Object.keys(blocked).length) {
    throw new Error('Source material has blocked roots: ' + Object.keys(blocked).join(', '));
  }
  if (!Object.keys(roots).length) throw new Error('Source material has no compiled material roots');
  for (const [root, value] of Object.entries(roots)) {
    if (!(root in INCLUDES)) throw new Error('Unsupported Three PBR material root: ' + root);
    const width = root === 'BaseColor' || root === 'EmissiveColor' ? 3 : 1;
    if (!value || value.width !== width || typeof value.glsl !== 'string' ||
        !value.glsl.length || value.glsl.length > 16384 ||
        !/^[a-zA-Z0-9_.,()\s+\-*\/]+$/.test(value.glsl)) {
      throw new Error('Unsafe typed material GLSL for: ' + root);
    }
    // Whitelist emitted operations/identifiers, not just punctuation: a
    // hand-modified source report must not inject arbitrary GLSL calls.
    // Strip numeric scientific notation before scanning identifiers.
    const lexical = value.glsl.replace(/(?<![a-zA-Z_0-9])(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+/g, '0.0');
    const identifiers = lexical.match(/[a-zA-Z_][a-zA-Z_0-9]*/g) || [];
    const builtins = new Set(['vec2', 'vec3', 'vec4', 'mix', 'clamp', 'abs', 'floor',
      'ceil', 'sqrt', 'round', 'sin', 'cos', 'fract', 'min', 'max', 'dot',
      'uePositiveClampedPow', 'smoothstep', 'normalize']);
    if (identifiers.some(id => !(builtins.has(id) || /^[xyzw]{1,4}$/.test(id) ||
        (/^uep_[1-9]\d*$/.test(id) &&
          Object.prototype.hasOwnProperty.call(lowering.uniforms || {}, id))))) {
      throw new Error('Unsafe typed material GLSL for: ' + root);
    }
  }
}

function uniformBindings(lowering, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('Provide original material-instance overrides or an explicit empty map');
  }
  const definitions = lowering.uniforms || {}, bindings = {};
  for (const name of Object.keys(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(definitions, name)) {
      throw new Error('Unwitnessed source material override: ' + name);
    }
  }
  for (const [name, def] of Object.entries(definitions)) {
    if (!/^uep_[1-9]\d*$/.test(name) || !def || !['float', 'vec4'].includes(def.type)) {
      throw new Error('Invalid source uniform schema');
    }
    const supplied = Object.prototype.hasOwnProperty.call(overrides, name)
      ? overrides[name] : def.default;
    const values = (Array.isArray(supplied) ? supplied : [supplied]).map(Number);
    const expected = def.type === 'vec4' ? 4 : 1;
    if (values.length !== expected || !values.every(Number.isFinite)) {
      throw new Error('Invalid original source parameter values: ' + name);
    }
    bindings[name] = {type: def.type, value: expected === 1
      ? values[0] : new Vector4(...values)};
  }
  return bindings;
}

function inject(fragment, lowering, uniforms) {
  const headers = Object.keys(uniforms).map(k => 'uniform ' + uniforms[k].type + ' ' + k + ';').join('\n');
  // UE Common.ush PositiveClampedPow avoids NaNs for nonpositive bases.
  // Preserve the same cutoff instead of substituting raw GLSL pow.
  const power = Object.values(lowering.translated_roots).some(x => x.glsl.includes('uePositiveClampedPow')) ? `
float uePositiveClampedPow(float b, float e) { return b <= 2.980233e-8 ? 0.0 : pow(b, e); }
vec2 uePositiveClampedPow(vec2 b, float e) { return vec2(uePositiveClampedPow(b.x,e),uePositiveClampedPow(b.y,e)); }
vec3 uePositiveClampedPow(vec3 b, float e) { return vec3(uePositiveClampedPow(b.x,e),uePositiveClampedPow(b.y,e),uePositiveClampedPow(b.z,e)); }
vec4 uePositiveClampedPow(vec4 b, float e) { return vec4(uePositiveClampedPow(b.x,e),uePositiveClampedPow(b.y,e),uePositiveClampedPow(b.z,e),uePositiveClampedPow(b.w,e)); }
` : '';
  let result = headers + '\n' + power + fragment;
  for (const [root, compiled] of Object.entries(lowering.translated_roots)) {
    const marker = '#include <' + INCLUDES[root] + '>';
    if (result.split(marker).length !== 2) throw new Error('Missing Three shader marker: ' + marker);
    result = result.replace(marker, marker + '\n' + ASSIGN[root](compiled.glsl));
  }
  return result;
}

/**
 * Creates a clone; never mutates original materials or GLBs. Only call after
 * independently witnessing the mesh/source-material binding.
 */
export function createSourceBoundPBRMaterial(original, lowering, {
  sourcePackage, parameterOverrides = {}
} = {}) {
  if (!original?.isMeshStandardMaterial) {
    throw new Error('Requires Three.MeshStandardMaterial');
  }
  if (typeof sourcePackage !== 'string' || !sourcePackage.startsWith('/')) {
    throw new Error('Requires source Unreal material package identity');
  }
  validate(lowering);
  const uniforms = uniformBindings(lowering, parameterOverrides);
  const result = original.clone();
  const previous = result.onBeforeCompile;
  result.onBeforeCompile = function ue2threeOnBeforeCompile(shader, renderer) {
    previous.call(this, shader, renderer);
    const bindings = {};
    for (const [name, item] of Object.entries(uniforms)) {
      if (name in shader.uniforms) throw new Error('Uniform collision: ' + name);
      bindings[name] = {value: item.value};
    }
    shader.fragmentShader = inject(shader.fragmentShader, lowering, uniforms);
    Object.assign(shader.uniforms, bindings);
  };
  const cacheKey = JSON.stringify([sourcePackage, lowering.translated_roots,
    Object.keys(uniforms), original.customProgramCacheKey()]);
  result.customProgramCacheKey = () => cacheKey;
  result.userData = {...result.userData, ue2three: {
    sourcePackage, status: 'glsl_bound_not_1to1_certified',
    sourceTextureParity: false, sourceLightingParity: false, originalMaterialCloned: true
  }};
  result.needsUpdate = true;
  return result;
}
