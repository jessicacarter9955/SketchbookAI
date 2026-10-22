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
  const graphs = Object.values(validation?.material_graphs || {}).filter(graph =>
    graph?.root_connections === 'direct_connections_recovered' && count(graph.connection_count));
  if (graphs.length) rows.push(`Shader sorgenti: ${graphs.reduce((sum, graph) => sum + graph.connection_count, 0)} collegamenti diretti recuperati; esecuzione ancora da tradurre.`);
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
      const response = await fetchManifest('/' + path.slice(0,path.lastIndexOf('/maps/')) + '/map-manifest.json', {cache: 'no-store'});
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
    fitDirectionalShadow(node, bounds);
    node.shadow.bias = -0.00005;
    node.shadow.normalBias = 0.08;
  });
  return {sourceDirectional, shadowLights};
}

export function fitDirectionalShadow(light, worldBounds) {
  if (!light.isDirectionalLight || worldBounds.isEmpty()) return false;
  light.updateWorldMatrix(true, false);
  light.target.updateWorldMatrix(true, false);
  light.shadow.updateMatrices(light);
  const camera = light.shadow.camera;
  const bounds = worldBounds.clone().applyMatrix4(camera.matrixWorldInverse);
  const margin = Math.max(0.1, bounds.getSize(new THREE.Vector3()).length() * 0.01);
  // Camera is already aligned with the ORIGINAL light/target. Fit its frustum
  // in light space; a symmetric box around world zero clips translated maps.
  Object.assign(camera, {left:bounds.min.x-margin, right:bounds.max.x+margin,
    bottom:bounds.min.y-margin, top:bounds.max.y+margin,
    near:Math.max(0.01, -bounds.max.z-margin), far:Math.max(0.02, -bounds.min.z+margin)});
  if (camera.far <= camera.near) camera.far = camera.near + 1;
  camera.updateProjectionMatrix();
  return true;
}

export function applyMapPresentation(renderer, scene, root) {
  const previous = {environment:scene.environment, background:scene.background};
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
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = Math.max(10, bounds.getSize(new THREE.Vector3()).length());
    key.position.copy(center).addScaledVector(new THREE.Vector3(8,15,9).normalize(),size);
    key.target.position.copy(center);
    scene.add(key, key.target);
    key.castShadow = true;
    key.shadow.mapSize.set(2048,2048);
    fitDirectionalShadow(key,bounds);
  }
  scene.background = new THREE.Color(0x182430);
  const background = scene.background;
  return {...settings, fallbackShadowLights:key ? 1 : 0, environment: 'neutral_approximation', source_equivalence:false, dispose() {
    scene.remove(ambient);
    if (key) { scene.remove(key, key.target); key.shadow.dispose(); }
    if (scene.environment === reflectionTarget.texture) scene.environment = previous.environment;
    if (scene.background === background) scene.background = previous.background;
    reflectionTarget.dispose();
  }};
}
