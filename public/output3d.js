import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { strokeOpacity, taperRadius } from './drawing-math.mjs';

// Dedicated receive-only view: no input handlers, controls, labels or axis helpers.
const canvas = document.getElementById('output');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (error) { document.getElementById('fatal').hidden = false; throw error; }
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); document.getElementById('fatal').hidden = false; });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setClearColor(0x000000);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 180);
const portrait = innerWidth < 700;
camera.position.set(portrait ? 2.1 : 0, 1.8, portrait ? 27 : 19);
camera.lookAt(portrait ? 2.1 : -1.2, 0, 0);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.65, 0.5));
composer.addPass(new OutputPass());
function resize() { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// A thin, breathing topology; no opaque surface obstructs the drawing plane.
const form = new THREE.Group();
form.position.set(2.15, -0.45, -1.6);
scene.add(form);
const topology = new THREE.TorusKnotGeometry(2.45, 0.88, 140, 12, 2, 3);
const wire = new THREE.WireframeGeometry(topology);
topology.dispose();
const baseWire = wire.attributes.position.array.slice();
const formMaterial = new THREE.LineBasicMaterial({ color: 0x8765bf, transparent: true, opacity: 0.40, blending: THREE.AdditiveBlending, depthWrite: false });
const sculpture = new THREE.LineSegments(wire, formMaterial);
form.add(sculpture);
const haloGeometry = new THREE.BufferGeometry();
const particlePositions = [];
for (let i = 0; i < 160; i++) { const a = i * 2.39996; const r = 5 + (i % 13) / 3; particlePositions.push(Math.cos(a) * r + 2, Math.sin(a) * r * 0.55, -5 - (i % 9)); }
haloGeometry.setAttribute('position', new THREE.Float32BufferAttribute(particlePositions, 3));
scene.add(new THREE.Points(haloGeometry, new THREE.PointsMaterial({ color: 0x9581aa, size: 0.019, transparent: true, opacity: 0.38, depthWrite: false })));

const textureCanvas = document.createElement('canvas'); textureCanvas.width = 128; textureCanvas.height = 32;
const textureContext = textureCanvas.getContext('2d');
textureContext.fillStyle = '#ffffff'; textureContext.fillRect(0, 0, 128, 32);
for (let x = 0; x < 128; x += 2) { textureContext.fillStyle = `rgba(40,8,50,${0.08 + (Math.sin(x * 4.7) + 1) * 0.08})`; textureContext.fillRect(x, 0, 1, 32); }
const strokeTexture = new THREE.CanvasTexture(textureCanvas);
strokeTexture.wrapS = strokeTexture.wrapT = THREE.RepeatWrapping;


const strokes = new Map();
let connected = false, serverOffset = 0, startedAt = Date.now(), seed = 1977;
const serverNow = () => Date.now() + serverOffset;
function removeStroke(id) {
  const entry = strokes.get(id); if (!entry) return;
  scene.remove(entry.group);
  entry.group.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
  strokes.delete(id);
}
function clearStrokes() { for (const id of [...strokes.keys()]) removeStroke(id); }
function addStroke(data) {
  if (strokes.has(data.id) || strokeOpacity(data, serverNow()) <= 0) return;
  const group = new THREE.Group(); scene.add(group);
  strokes.set(data.id, { data: { ...data, points: data.points.map(point => [...point]) }, group, dirty: true, lastBuild: 0 });
}
function buildStroke(entry) {
  const points = entry.data.points;
  if (!points.length) return;
  const vectors = [];
  // Bound reconstruction to 360 samples regardless of input frequency.
  const stride = Math.max(1, Math.ceil(points.length / 360));
  for (let i = 0; i < points.length; i += stride) vectors.push(new THREE.Vector3(...points[i]));
  const end = new THREE.Vector3(...points.at(-1));
  if (!vectors.at(-1).equals(end)) vectors.push(end);
  let geometry;
  if (vectors.length < 2) { geometry = new THREE.SphereGeometry(entry.data.width * 0.48, 8, 6); geometry.translate(...points[0]); }
  else {
    const curve = new THREE.CatmullRomCurve3(vectors, false, 'centripetal');
    const segments = Math.min(540, Math.max(12, vectors.length * 2));
    geometry = new THREE.TubeGeometry(curve, segments, entry.data.width / 2, 8, false);
    const position = geometry.attributes.position;
    const center = new THREE.Vector3(), vertex = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      curve.getPointAt(i / segments, center);
      const radius = taperRadius(i / segments);
      for (let j = 0; j <= 8; j++) {
        const index = i * 9 + j;
        vertex.fromBufferAttribute(position, index).sub(center).multiplyScalar(radius).add(center);
        position.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  if (!entry.shell) {
    const tint = new THREE.Color(entry.data.color).multiplyScalar(2.1);
    const shellMaterial = new THREE.MeshBasicMaterial({ color: tint, map: strokeTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const coreMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(entry.data.color).lerp(new THREE.Color('#ffffff'), 0.65).multiplyScalar(2.2), transparent: true, depthWrite: false });
    entry.shell = new THREE.Mesh(geometry, shellMaterial);
    entry.core = new THREE.Mesh(geometry.clone(), coreMaterial);
    entry.group.add(entry.shell, entry.core);
  } else { entry.shell.geometry.dispose(); entry.core.geometry.dispose(); entry.shell.geometry = geometry; entry.core.geometry = geometry.clone(); }
  // Scale each core ring around its own center, not the world origin.
  if (vectors.length >= 2) {
    const positions = entry.core.geometry.attributes.position;
    const shellPositions = geometry.attributes.position;
    const radial = 9, rings = positions.count / radial;
    const center = new THREE.Vector3(), vertex = new THREE.Vector3();
    for (let ring = 0; ring < rings; ring++) {
      center.set(0, 0, 0);
      for (let j = 0; j < 8; j++) center.add(vertex.fromBufferAttribute(shellPositions, ring * radial + j));
      center.multiplyScalar(1 / 8);
      for (let j = 0; j < radial; j++) { const idx = ring * radial + j; vertex.fromBufferAttribute(shellPositions, idx).sub(center).multiplyScalar(0.30).add(center); positions.setXYZ(idx, vertex.x, vertex.y, vertex.z); }
    }
    positions.needsUpdate = true;
  }
  entry.dirty = false;
}


const socket = window.io({ reconnection: true });
socket.on('scene:snapshot', snapshot => {
  clearStrokes();
  serverOffset = (snapshot.serverTime ?? Date.now()) - Date.now();
  seed = snapshot.seed; startedAt = snapshot.startedAt;
  snapshot.strokes.forEach(addStroke);
  connected = true;
});
socket.on('disconnect', () => { connected = false; });
socket.on('connect_error', () => { connected = false; });
socket.on('stroke:started', addStroke);
socket.on('stroke:appended', ({ id, points }) => {
  const entry = strokes.get(id); if (!entry) return;
  entry.data.points.push(...points); entry.dirty = true;
});
socket.on('stroke:ended', ({ id }) => {
  const entry = strokes.get(id); if (entry) { entry.data.ended = true; entry.dirty = true; }
});
socket.on('stroke:removed', ({ id }) => removeStroke(id));
socket.on('scene:cleared', clearStrokes);

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(time) {
  requestAnimationFrame(animate);
  const now = serverNow();
  for (const entry of strokes.values()) {
    const opacity = strokeOpacity(entry.data, now);
    if (opacity <= 0) { removeStroke(entry.data.id); continue; }
    if (entry.dirty && time - entry.lastBuild > 50) { buildStroke(entry); entry.lastBuild = time; }
    if (entry.shell) { entry.shell.material.opacity = opacity * 0.78; entry.core.material.opacity = opacity; }
  }
  const t = reduceMotion ? 0 : (now - startedAt) / 1000;
  form.rotation.set(0.35 + Math.sin(t * 0.09) * 0.15, t * 0.055 + seed * 0.001, Math.sin(t * 0.055) * 0.13);
  form.scale.setScalar(1 + Math.sin(t * 0.5) * 0.035);
  const positions = wire.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    const x = baseWire[i], y = baseWire[i + 1], z = baseWire[i + 2];
    const wave = 1 + Math.sin(x * 1.5 + t * 0.7 + seed) * Math.cos(y * 1.1 + t * 0.3) * 0.05;
    positions[i] = x * wave; positions[i + 1] = y * wave; positions[i + 2] = z * wave;
  }
  wire.attributes.position.needsUpdate = true;
  composer.render();
}
requestAnimationFrame(animate);
window.__output3d = {
  get connected() { return connected; },
  get strokeCount() { return strokes.size; },
  get strokes() { return [...strokes.values()].map(entry => structuredClone(entry.data)); },
  scene, camera
};
