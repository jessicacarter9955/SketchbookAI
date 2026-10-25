import test from 'node:test';
import assert from 'node:assert/strict';
import {MeshStandardMaterial, Vector4} from 'three';
import {createSourceBoundPBRMaterial} from '../tools/ue2three/material-three-runtime.mjs';

const packageName = '/Game/Fixers/VFX/NiagaraExamples/Gallery/DemoPlatform/Materials/MD_Col';
const lowering = (roots, blocked = {}, uniforms = {}) => ({
  schema_version: 1, shader_execution: 'not_integrated',
  translated_roots: roots, blocked_roots: blocked, uniforms
});

function shader() {
  return {uniforms: {}, fragmentShader: [
    '#include <color_fragment>', '#include <roughnessmap_fragment>',
    '#include <metalnessmap_fragment>', '#include <emissivemap_fragment>',
    '#include <alphamap_fragment>'
  ].join('\n')};
}

test('opt-in adapter clones material and binds source GLSL at Three PBR markers', () => {
  const original = new MeshStandardMaterial({color: 0xffffff});
  const verified = lowering({BaseColor: {glsl: 'vec3(0.2, 0.4, 0.6)', width: 3},
    Roughness: {glsl: '0.5', width: 1}});
  const output = createSourceBoundPBRMaterial(original, verified, {sourcePackage: packageName});
  assert.notEqual(output, original);
  assert.equal(original.userData.ue2three, undefined);
  const program = shader();
  output.onBeforeCompile(program, {});
  assert.match(program.fragmentShader, /diffuseColor.rgb = vec3\(0\.2, 0\.4, 0\.6\)/);
  assert.match(program.fragmentShader, /roughnessFactor = clamp\(0\.5, 0\.0, 1\.0\)/);
  assert.equal(output.userData.ue2three.status, 'glsl_bound_not_1to1_certified');
  assert.equal(output.userData.ue2three.sourceTextureParity, false);
});

test('source scalar and vec4 uniforms are bound with strict widths and overrides', () => {
  const verified = lowering({BaseColor: {glsl: '(uep_1).xyz', width: 3}},
    {}, {uep_1: {type: 'vec4', default: ['0.2', '0.3', '0.4', '1.0']}});
  const output = createSourceBoundPBRMaterial(new MeshStandardMaterial(), verified, {
    sourcePackage: packageName, parameterOverrides: {uep_1: [0.8, 0.7, 0.6, 1]}});
  const program = shader();
  output.onBeforeCompile(program, {});
  assert.ok(program.uniforms.uep_1.value instanceof Vector4);
  assert.deepEqual(program.uniforms.uep_1.value.toArray(), [0.8, 0.7, 0.6, 1]);
  assert.match(program.fragmentShader, /uniform vec4 uep_1;/);
  assert.match(program.fragmentShader, /diffuseColor.rgb = \(uep_1\).xyz/);
});

test('missing source roots, source identity, unsupported roots and tampered GLSL fail closed', () => {
  const base = new MeshStandardMaterial();
  const create = value => createSourceBoundPBRMaterial(base, value, {sourcePackage: packageName});
  assert.throws(() => create(lowering({BaseColor: {glsl: 'vec3(1.)', width: 3}},
    {WorldPositionOffset: 'not translated'})), /blocked roots/);
  assert.throws(() => create(lowering({Normal: {glsl: 'vec3(1.)', width: 3}})),
    /Unsupported Three PBR/);
  assert.throws(() => create(lowering({BaseColor: {glsl: 'eval(foo)', width: 3}})),
    /Unsafe typed/);
  assert.throws(() => create(lowering({})), /no compiled material/);
  assert.throws(() => createSourceBoundPBRMaterial(base, lowering({
    BaseColor: {glsl: 'vec3(1.)', width: 3}})), /identity/);
});

test('unsupported overrides and missing Three shader chunks never silently pass', () => {
  const base = new MeshStandardMaterial();
  const verified = lowering({BaseColor: {glsl: 'uep_1', width: 3}}, {},
    {uep_1: {type: 'vec4', default: [1, 1, 1, 1]}});
  assert.throws(() => createSourceBoundPBRMaterial(base, verified, {
    sourcePackage: packageName, parameterOverrides: {uep_9: [1, 1, 1, 1]}}), /Unwitnessed/);
  const output = createSourceBoundPBRMaterial(base, verified, {sourcePackage: packageName});
  assert.throws(() => output.onBeforeCompile({uniforms: {}, fragmentShader: '#include <alphamap_fragment>'}, {}),
    /Missing Three shader marker/);
});
