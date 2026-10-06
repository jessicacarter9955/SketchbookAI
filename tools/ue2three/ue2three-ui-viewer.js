import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const query = new URLSearchParams(location.search);
const model = query.get('model') || '';
const manifestPath = query.get('manifest') || '';
const screen = document.querySelector('#screen');
const status = document.querySelector('#status');
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

function findValue(value, names) {
  if (!value || typeof value !== 'object') return undefined;
  for (const name of names) if (Object.hasOwn(value, name)) return value[name];
  for (const child of Object.values(value)) {
    const found = findValue(child, names);
    if (found !== undefined) return found;
  }
}

function textValue(node, properties, inherited) {
  // WBP_FixersMenuButton exposes ButtonText on the source instance and sets
  // Txt_Label from it in its EventGraph. Preserve that real widget input.
  if (node?.name === 'Txt_Label' && typeof inherited?.ButtonText === 'string') return inherited.ButtonText;
  const own = properties?.Text;
  if (typeof own === 'string' && own.trim()) return own;
  if (typeof inherited === 'string' && inherited.trim()) return inherited;
  const inheritedText = Object.entries(inherited || {}).find(([key, value]) => /text|label/i.test(key) && typeof value === 'string');
  return inheritedText?.[1] || '';
}

function colorValue(properties) {
  const color = findValue(properties?.ColorAndOpacity, ['R']);
  if (!color || typeof color !== 'object') return null;
  const channels = ['R', 'G', 'B'].map(name => Number(color[name]));
  if (!channels.every(Number.isFinite)) return null;
  return `rgb(${channels.map(c => Math.round(Math.max(0, Math.min(1, c)) * 255)).join(' ')})`;
}

function marginValue(value) {
  if (!value || typeof value !== 'object') return null;
  const names = Object.keys(value);
  if (['Left', 'Top', 'Right', 'Bottom'].every(name => names.includes(name))) {
    return `${Number(value.Top) || 0}px ${Number(value.Right) || 0}px ${Number(value.Bottom) || 0}px ${Number(value.Left) || 0}px`;
  }
  if (Array.isArray(value) && value.length === 4) return `${value.map(n => `${Number(n) || 0}px`).join(' ')}`;
  return null;
}

function vector2(value) {
  let current = value;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if (Number.isFinite(Number(current.X)) && Number.isFinite(Number(current.Y))) return current;
    current = Object.values(current).find(child => child && typeof child === 'object');
  }
  return {};
}

function applySlot(element, slot) {
  if (!slot || typeof slot !== 'object') return;
  const layout = slot.LayoutData || {};
  const offsets = layout.Offsets || layout;
  const anchor = layout.Anchors || {};
  const left = Number(offsets.Left ?? offsets.left);
  const top = Number(offsets.Top ?? offsets.top);
  const right = Number(offsets.Right ?? offsets.right);
  const bottom = Number(offsets.Bottom ?? offsets.bottom);
  const min = vector2(anchor.Minimum || anchor.minimum);
  const max = vector2(anchor.Maximum || anchor.maximum);
  const ax = Number(min.X || 0), ay = Number(min.Y || 0), bx = Number(max.X ?? ax), by = Number(max.Y ?? ay);
  if ([left, top, right, bottom].every(Number.isFinite)) {
    element.style.position = 'absolute';
    element.style.left = `calc(${ax * 100}% + ${left}px)`;
    element.style.top = `calc(${ay * 100}% + ${top}px)`;
    element.style.width = ax === bx ? `${Math.max(0, right - left)}px` :
      `calc(${(bx - ax) * 100}% + ${right - left}px)`;
    element.style.height = ay === by ? `${Math.max(0, bottom - top)}px` :
      `calc(${(by - ay) * 100}% + ${bottom - top}px)`;
  }
  const padding = marginValue(slot.Padding);
  if (padding) element.style.margin = padding;
  if (slot.HorizontalAlignment) element.style.justifySelf = String(slot.HorizontalAlignment).toLowerCase().replace('hAlign_', '');
  if (slot.VerticalAlignment) element.style.alignSelf = String(slot.VerticalAlignment).toLowerCase().replace('vAlign_', '');
}

function build(node, inherited = null) {
  const kind = node?.kind || 'unsupported';
  const properties = node?.properties || {};
  const instance = node?.instance || inherited;
  const text = textValue(node, properties, instance);
  let element;
  if (kind === 'Button' || /Button/.test(kind)) {
    element = document.createElement('button');
    element.type = 'button';
    element.className = 'umg-node umg-button';
    const nestedBoundLabel = node?.children?.some(child => child.name === 'Txt_Label');
    const label = text || properties.DisplayLabel || instance?.ButtonText || node.name || 'Button';
    element.setAttribute('aria-label', label);
    if (!nestedBoundLabel) element.textContent = label;
    element.addEventListener('click', () => {
      status.replaceChildren(document.createTextNode(`«${label}»: la grafica è stata migrata; l’evento Blueprint collegato è nel lotto di traduzione successivo.`));
    });
  } else if (/TextBlock|RichText/.test(kind)) {
    element = document.createElement('span');
    element.className = 'umg-node';
    element.textContent = text || properties.DisplayLabel || '';
  } else if (kind === 'Image') {
    element = document.createElement('div'); element.className = 'umg-node umg-image umg-unsupported';
    element.setAttribute('aria-label', 'Immagine Unreal da convertire');
  } else {
    element = document.createElement('div');
    element.className = 'umg-node';
    if (kind === 'CanvasPanel') element.classList.add('umg-canvas');
    else if (/VerticalBox/.test(kind)) element.classList.add('umg-vbox');
    else if (/HorizontalBox/.test(kind)) element.classList.add('umg-hbox');
    else if (/Overlay/.test(kind)) element.classList.add('umg-overlay');
    else if (/Border|SizeBox|ScaleBox|ScrollBox|UniformGridPanel/.test(kind)) element.style.display = 'flex';
    else element.classList.add('umg-custom');
    if (/unsupported|cycle|depth-limit|missing/i.test(kind)) element.classList.add('umg-unsupported');
  }
  element.dataset.ueWidget = kind;
  element.dataset.ueName = node?.name || '';
  const color = colorValue(properties);
  if (color) element.style.color = color;
  const font = properties.Font;
  if (Array.isArray(font)) {
    const size = Number(font.find(item => typeof item === 'number' && item > 1 && item < 300));
    if (size) element.style.fontSize = `${size}px`;
  }
  if (properties.Visibility && /collapsed|hidden/i.test(String(properties.Visibility))) element.hidden = true;
  if (node?.slot) applySlot(element, node.slot);
  for (const child of node?.children || []) element.append(build(child, instance));
  return element;
}

async function start() {
  if (!model.startsWith('build/local-scenes/ue2three/projects/') || model.includes('..') ||
      !manifestPath.startsWith('build/local-scenes/ue2three/projects/') || manifestPath.includes('..')) {
    throw new Error('Percorso della migrazione non valido. Riapri la schermata dal Migration Manager.');
  }
  const [gltf, manifestResponse] = await Promise.all([
    new GLTFLoader().loadAsync('/' + model),
    fetch('/' + manifestPath, { cache: 'no-store' })
  ]);
  if (!manifestResponse.ok) throw new Error('Manifest della schermata Unreal non disponibile.');
  const manifest = await manifestResponse.json();
  document.querySelector('#title').textContent = `${manifest.root_widget.split('/').pop()} · schermata Unreal`;
  scene.add(gltf.scene); fit(gltf.scene);
  const root = build(manifest.tree);
  root.classList.add('umg-screen');
  const uiScale = Math.min(innerWidth / 1920, innerHeight / 1080);
  root.style.transform = `scale(${uiScale})`;
  root.style.transformOrigin = 'top left';
  root.style.left = `${Math.max(0, (innerWidth - 1920 * uiScale) / 2)}px`;
  root.style.top = `${Math.max(0, (innerHeight - 1080 * uiScale) / 2)}px`;
  screen.append(root);
  status.replaceChildren(document.createTextNode(`${manifest.widget_blueprints.length} Widget Blueprint letti dal progetto DDS.`));
  const details = document.createElement('span');
  details.className = 'minor';
  details.textContent = manifest.limitations?.join(' ') || '';
  status.append(details);
}

start().catch(error => { status.classList.add('error'); status.textContent = `Schermata non caricata: ${error.message}`; });
function render() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(render); }
render();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  const root = screen.querySelector('.umg-screen');
  if (root) {
    const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
    root.style.transform = `scale(${scale})`;
    root.style.left = `${Math.max(0, (innerWidth - 1920 * scale) / 2)}px`;
    root.style.top = `${Math.max(0, (innerHeight - 1080 * scale) / 2)}px`;
  }
});
