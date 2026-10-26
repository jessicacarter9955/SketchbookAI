/** Bind compiled original material graphs to exact, published glTF slots.
 * Unsupported graphs/instances keep their exported material. This is an
 * execution hook, not GPU compilation or visual parity certification.
 */
import {createSourceBoundPBRMaterial} from './material-three-runtime.mjs';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

export function bindSourceSceneMaterials(gltf, manifest, report, {assetSHA256} = {}) {
  if (manifest?.schema_version !== 1 || report?.schema_version !== 1 ||
      !hash(assetSHA256) || manifest.glb_sha256 !== assetSHA256 ||
      typeof manifest.project !== 'string' || manifest.project !== report.source_project ||
      !hash(manifest.source_snapshot_hash) || manifest.source_snapshot_hash !== report.source_snapshot_hash ||
      !Array.isArray(manifest.bindings) || !gltf?.scene?.traverse || !gltf.parser?.associations?.get) {
    throw new Error('Source material bindings do not match the published glTF and inventory');
  }
  const byIndex = new Map();
  for (const row of manifest.bindings) {
    if (!Number.isSafeInteger(row?.material_index) || row.material_index < 0 || byIndex.has(row.material_index) ||
        typeof row.source_package !== 'string' || !row.source_package.startsWith('/') ||
        !hash(row.source_sha256) || row.source_class !== 'Material' ||
        typeof row.material_name !== 'string' || !row.material_name ||
        !row.parameter_overrides || typeof row.parameter_overrides !== 'object') {
      throw new Error('Invalid or duplicate witnessed source material slot');
    }
    byIndex.set(row.material_index, row);
  }
  const audit = {status: 'source_bindings_applied_not_1to1_certified', bound_materials: 0,
    bound_mesh_slots: 0, preserved_mesh_slots: 0, blocked: [], gpu_compilation_verified: false,
    visual_parity_verified: false};
  const clones = new Map(), originals = [];
  gltf.scene.traverse(node => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const next = materials.map(original => {
      const index = gltf.parser.associations.get(original)?.materials;
      const witness = byIndex.get(index);
      if (!witness) { audit.preserved_mesh_slots++; return original; }
      if (clones.has(original)) { audit.bound_mesh_slots++; return clones.get(original); }
      try {
        const lowering = report.materials?.[witness.source_package];
        if (original.name !== witness.material_name || lowering?.source_sha256 !== witness.source_sha256) {
          throw new Error('Original source material identity or hash mismatch');
        }
        // Successful mesh-dependent bakes already carry source appearance.
        // Replacing their texture path with an unrelated graph is forbidden.
        if (['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap']
          .some(key => original[key])) throw new Error('Exported texture bake retained');
        const clone = createSourceBoundPBRMaterial(original, lowering, {
          sourcePackage: witness.source_package, parameterOverrides: witness.parameter_overrides});
        clones.set(original, clone); audit.bound_materials++; audit.bound_mesh_slots++;
        return clone;
      } catch (error) {
        audit.blocked.push({material_index: index, source_package: witness.source_package,
          reason: error.message}); audit.preserved_mesh_slots++;
        return original;
      }
    });
    if (next.some((material, index) => material !== materials[index])) {
      originals.push([node, node.material]);
      node.material = Array.isArray(node.material) ? next : next[0];
    }
  });
  return {...audit, dispose() {
    for (const [node, material] of originals) node.material = material;
    for (const material of clones.values()) material.dispose();
  }};
}

export async function loadSourceSceneMaterials(gltf, assetURL, {fetchJSON = globalThis.fetch} = {}) {
  const url = new URL(assetURL, 'http://localhost');
  const missing = {status: 'source_bindings_unavailable', bound_materials: 0,
    gpu_compilation_verified: false, visual_parity_verified: false, dispose() {}};
  const match = url.pathname.match(/^(\/build\/local-scenes\/ue2three\/projects\/[A-Za-z0-9_-]+)\/(?:[A-Za-z0-9_-]+\/)*maps\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)\.glb$/);
  if (!match || /[%]|\.\./.test(url.pathname)) return {...missing, status:'source_bindings_rejected', error:'Invalid source material map URL'};
  const folder = url.pathname.slice(0,url.pathname.lastIndexOf('/'));
  try {
    const [bindings, report] = await Promise.all([
      fetchJSON(`${folder}/${match[2]}.materials.json`, {cache: 'no-store'}),
      fetchJSON(`${match[1]}/material-glsl-report.json`, {cache: 'no-store'})]);
    if (!bindings.ok || !report.ok) return missing;
    return bindSourceSceneMaterials(gltf, await bindings.json(), await report.json(), {
      assetSHA256: url.searchParams.get('revision')});
  } catch (error) { return {...missing, status: 'source_bindings_rejected', error: error.message}; }
}
