import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const params = new URLSearchParams(location.search);
const base = params.get('base') || 'build/local-scenes/ue2three/current/';
const status = document.querySelector('#status');
const clipSelect = document.querySelector('#clip');
const weaponSelect = document.querySelector('#weapon');
const playButton = document.querySelector('#play');
const sourceLabel = document.querySelector('#source');
const safeBase = value => {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized.startsWith('build/local-scenes/ue2three/') || normalized.includes('..'))
    throw new Error('Percorso risorse non valido. Riapri il personaggio dal Migration Manager.');
  return normalized.endsWith('/') ? normalized : normalized + '/';
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
const clock = new THREE.Clock();
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.querySelector('#view').append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x182430);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(2.5, 1.7, 3.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.9, 0);
scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x3c4853, 2));
const key = new THREE.DirectionalLight(0xffedcf, 3.1);
key.position.set(3, 6, 4);
scene.add(key);
const fill = new THREE.DirectionalLight(0x8abaff, 1.4);
fill.position.set(-4, 2, -3);
scene.add(fill);
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 64), new THREE.MeshStandardMaterial({ color: 0x263745, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.02;
scene.add(floor);

let mixer;
let activeAction;
let character;
let manifest;
let weaponRoot;
const loader = new GLTFLoader();

function startClip(name) {
  const clip = character?.animations?.find(item => item.name === name);
  if (!clip) return;
  const action = mixer.clipAction(clip);
  if (activeAction === action && action.isRunning()) return;
  action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.18).play();
  activeAction?.fadeOut(0.18);
  activeAction = action;
  mixer.update(0.18);
  fitCharacter();
  status.textContent = `Asset sorgente in riproduzione: ${name}.`;
}

function fitCharacter() {
  if (!character?.scene) return;
  character.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(character.scene);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  const distance = Math.max(
    size.y / (2 * Math.tan(vertical / 2)),
    size.x / (2 * Math.tan(horizontal / 2)),
    size.z / (2 * Math.tan(horizontal / 2)),
    1
  ) * 1.55;
  const direction = new THREE.Vector3(0.45, 0.2, 1).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const screenRight = camera.getWorldDirection(new THREE.Vector3())
    .cross(new THREE.Vector3(0, 1, 0)).normalize();
  // The compact controls panel sits at the upper right. Shift the framing away
  // from it so the head and held weapon remain visible while inspecting sockets.
  const panelSide = innerWidth <= 850 ? 1 : -1;
  const framedCenter = center.clone().addScaledVector(screenRight, size.x * 0.3 * panelSide);
  controls.target.copy(framedCenter);
  camera.position.add(framedCenter.clone().sub(center));
  camera.near = Math.max(0.01, distance / 1000);
  camera.far = Math.max(100, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

async function equipWeapon(name) {
  weaponRoot?.removeFromParent();
  weaponRoot = null;
  if (!name) return;
  const definition = manifest.attachment_assets?.[name];
  if (!definition) throw new Error(`Arma non presente nel manifest esportato: ${name}`);
  const hand = character.scene.getObjectByName(definition.bone);
  if (!hand) throw new Error(`Socket esportato mancante: ${definition.bone}`);
  const asset = await loader.loadAsync(safeBase(base) + definition.file);
  const sourcePose = character.animations.find(clip => clip.name === `${name}_aim`) ||
    character.animations.find(clip => clip.name === `${name}_ready`);
  if (!sourcePose) throw new Error(`Posa sorgente di impugnatura mancante per ${name}`);

  // Calibrate the attachment in the weapon's original aim pose. The inverse hand
  // rotation keeps the exported weapon basis aligned while the source clip moves
  // the hand, matching the grip compensation already used by the DDS character rig.
  const reference = cloneSkeleton(character.scene);
  const referenceMixer = new THREE.AnimationMixer(reference);
  referenceMixer.clipAction(sourcePose).play();
  referenceMixer.update(0);
  reference.updateMatrixWorld(true);
  const referenceHand = reference.getObjectByName(definition.bone);
  if (!referenceHand) throw new Error(`Bone di calibrazione mancante: ${definition.bone}`);
  const handRotation = referenceHand.getWorldQuaternion(new THREE.Quaternion());
  weaponRoot = new THREE.Group();
  weaponRoot.name = `DDS ${name} calibrated grip`;
  weaponRoot.quaternion.copy(handRotation.invert());
  hand.add(weaponRoot);

  const weapon = asset.scene;
  const transform = definition.transform || {};
  weapon.position.fromArray(transform.position || [0, 0, 0]);
  weapon.rotation.set(...(transform.rotation || [0, 0, 0]), 'XYZ');
  weapon.scale.fromArray(transform.scale || [1, 1, 1]);
  weaponRoot.add(weapon);
  fitCharacter();
  referenceMixer.stopAllAction();
  referenceMixer.uncacheRoot(reference);
}

async function openCharacter() {
  const assetBase = safeBase(base);
  const response = await fetch('/' + assetBase + 'manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Manifest del personaggio migrato non disponibile.');
  manifest = await response.json();
  const model = await loader.loadAsync('/' + assetBase + manifest.mesh);
  character = model;
  scene.add(model.scene);
  model.scene.updateMatrixWorld(true);
  fitCharacter();

  const names = Object.keys(manifest.clips || {}).sort();
  for (const name of names) {
    const gltf = await loader.loadAsync('/' + assetBase + manifest.clips[name]);
    if (!gltf.animations?.length) throw new Error(`Animazione esportata senza clip: ${name}`);
    const clip = gltf.animations[0].clone();
    clip.name = name;
    mixer ||= new THREE.AnimationMixer(model.scene);
    // Keep the animation tracks as exported. This viewer does not retarget or synthesize motion.
    model.animations ||= [];
    model.animations.push(clip);
  }
  mixer ||= new THREE.AnimationMixer(model.scene);
  clipSelect.replaceChildren(...names.map(name => new Option(name, name)));
  clipSelect.disabled = false;
  clipSelect.addEventListener('change', () => startClip(clipSelect.value));
  weaponSelect.replaceChildren(new Option('Nessuna', ''), ...Object.keys(manifest.attachment_assets || {}).sort().map(name => new Option(name, name)));
  weaponSelect.disabled = false;
  weaponSelect.addEventListener('change', () => equipWeapon(weaponSelect.value).catch(showError));
  playButton.disabled = false;
  playButton.addEventListener('click', () => {
    const running = activeAction?.isRunning();
    if (running) activeAction.paused = true;
    else if (activeAction) activeAction.paused = false;
    else startClip(clipSelect.value);
    const playing = !running;
    playButton.textContent = playing ? 'In riproduzione' : 'Riprendi';
    playButton.setAttribute('aria-pressed', String(playing));
  });
  sourceLabel.textContent = `${manifest.source?.mesh || 'Mesh dal manifest'} · ${names.length} clip esportate · ${Object.keys(manifest.attachment_assets || {}).length} armi esportate`;
  clipSelect.value = names.includes('idle') ? 'idle' : names[0];
  startClip(clipSelect.value);
  weaponSelect.value = '';
  status.textContent = `Risorse caricate: mesh originale esportata, ${names.length} animazioni e ${Object.keys(manifest.attachment_assets || {}).length} armi.`;
}

function showError(error) {
  status.classList.add('error');
  status.textContent = `Caricamento non riuscito: ${error.message}`;
}

openCharacter().catch(showError);
function render() {
  requestAnimationFrame(render);
  mixer?.update(Math.min(0.05, clock.getDelta()));
  controls.update();
  renderer.render(scene, camera);
}
render();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  fitCharacter();
});
