import * as THREE from 'three';

export function mapValidationSummary(validation) {
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const rows = [];
  const transforms = validation?.transforms;
  if (transforms && ['matched', 'mismatched', 'skipped'].every(key => count(transforms[key]))) {
    rows.push(`Trasformazioni esplicite: ${transforms.matched} coerenti, ${transforms.mismatched} diverse, ${transforms.skipped} non confrontabili.`);
  } else rows.push('Confronto delle trasformazioni sorgenti non disponibile.');
  if (Array.isArray(validation?.landscapes)) {
    const repaired = validation.landscapes.reduce((sum, row) => sum + (count(row?.repaired_vertices) ? row.repaired_vertices : 0), 0);
    if (repaired) rows.push(`Terreno: ${repaired} vertici corretti entro i limiti sorgenti.`);
  }
  if (Array.isArray(validation?.material_fallbacks)) {
    rows.push(`Materiali: ${validation.material_fallbacks.length} ripieghi sui colori sorgenti; fedeltà degli shader ancora da verificare.`);
  } else rows.push('Fedeltà dei materiali non verificata.');
  rows.push('Illuminazione ambiente approssimata; confronto visivo ancora aperto.');
  return rows;
}

export function safeMapPath(value) {
  const path = String(value || '').replace(/\\/g, '/');
  if (!path.startsWith('build/local-scenes/ue2three/projects/') || !path.includes('/maps/') ||
      /\.\.|[?#%]/.test(path) || !path.toLowerCase().endsWith('.glb')) {
    throw new Error('Percorso mappa Unreal non valido. Riapri il livello dal Migration Manager.');
  }
  return path;
}

export async function mapAssetURL(value, {revision, fetchManifest = globalThis.fetch, now = Date.now} = {}) {
  const path = safeMapPath(value);
  // A page revision may describe the JS bundle, rather than the exported map.
  let hash = /^[a-f0-9]{64}$/i.test(revision || '') ? revision : null;
  if (!hash) {
    try {
      const response = await fetchManifest('/' + path.split('/maps/')[0] + '/map-manifest.json', {cache: 'no-store'});
      if (response.ok) {
        const manifest = await response.json();
        const candidate = manifest.maps?.find(row => row.filename === path.split('/').pop())?.output_sha256;
        if (/^[a-f0-9]{64}$/i.test(candidate || '')) hash = candidate;
      }
    } catch { /* Older exports remain loadable when their manifest is unavailable. */ }
  }
  return '/' + path + '?revision=' + encodeURIComponent(hash || now());
}

export function configureMapLights(renderer, root) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.useLegacyLights = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const radius = Math.max(10, bounds.getSize(new THREE.Vector3()).length() * 0.5);
  let sourceDirectional = 0, shadowLights = 0;
  root.traverse(node => {
    if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    if (!node.isLight) return;
    // One 2048 shadow map keeps this usable on a laptop. Other source lights
    // still illuminate the scene, without allocating six maps per point light.
    node.castShadow = false;
    if (!node.isDirectionalLight) return;
    sourceDirectional++;
    if (shadowLights) return;
    node.castShadow = true;
    shadowLights++;
    node.shadow.mapSize.set(2048, 2048);
    Object.assign(node.shadow.camera, {left: -radius, right: radius, top: radius,
      bottom: -radius, near: 0.1, far: radius * 6});
    node.shadow.camera.updateProjectionMatrix();
    node.shadow.bias = -0.00005;
    node.shadow.normalBias = 0.08;
  });
  return {sourceDirectional, shadowLights};
}

export function applyMapPresentation(renderer, scene, root) {
  const settings = configureMapLights(renderer, root);
  const ambient = new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.5);
  scene.add(ambient);
  // glTF has no UE SkyLight/Lumen capture. This is an explicitly approximate
  // neutral reflection environment; source PBR material values stay intact.
  const reflectionScene = new THREE.Scene();
  reflectionScene.background = new THREE.Color(0.25, 0.25, 0.25);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const reflectionTarget = pmrem.fromScene(reflectionScene, 0);
  scene.environment = reflectionTarget.texture;
  pmrem.dispose();
  let key;
  if (!settings.sourceDirectional) {
    key = new THREE.DirectionalLight(0xffedcf, 2.2);
    key.position.set(8, 15, 9);
    scene.add(key);
  }
  scene.background = new THREE.Color(0x182430);
  return {...settings, environment: 'neutral_approximation', dispose() {
    scene.remove(ambient);
    if (key) scene.remove(key);
    if (scene.environment === reflectionTarget.texture) scene.environment = null;
    reflectionTarget.dispose();
  }};
}
