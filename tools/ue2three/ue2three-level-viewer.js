import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const params = new URLSearchParams(location.search);
const model = params.get('model') || '';
const title = params.get('title') || 'Mappa Unreal migrata';
const status = document.querySelector('#status');
document.querySelector('#title').textContent = title;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.querySelector('#view').append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x182430);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 100000);
camera.position.set(8, 7, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xc7e4ff, 0x35404b, 1.5));
const key = new THREE.DirectionalLight(0xffedcf, 2.2);
key.position.set(8, 15, 9);
scene.add(key);
scene.add(new THREE.GridHelper(100, 100, 0x496176, 0x2c3b49));

function fit(object) {
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;
  const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(distance * 0.85, distance * 0.65, distance * 0.85));
  camera.near = Math.max(0.01, distance / 10000);
  camera.far = Math.max(10000, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

async function openModel() {
  if (!model.startsWith('build/local-scenes/ue2three/projects/') || model.includes('..')) {
    throw new Error('Percorso del modello non valido. Riapri la scena dal Migration Manager.');
  }
  const gltf = await new GLTFLoader().loadAsync('/' + model);
  scene.add(gltf.scene);
  fit(gltf.scene);
  status.textContent = 'Scena Unreal caricata. Trascina per ruotare, rotella per zoom.';
}

openModel().catch(error => {
  status.classList.add('error');
  status.textContent = `Caricamento non riuscito: ${error.message}`;
});

function render() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(render); }
render();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
