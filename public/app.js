import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { strokeOpacity, taperRadius } from './drawing-math.mjs';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600); }
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); }
catch (error) { $('fatal').hidden = false; throw error; }
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); $('fatal').hidden = false; });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setClearColor(0x000000);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 180);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minDistance = 3;
controls.maxDistance = 50;
controls.enablePan = false;
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
function resetCamera() { const portrait = innerWidth < 700; camera.position.set(portrait ? 2.1 : 0, 1.8, portrait ? 27 : 19); controls.target.set(portrait ? 2.1 : -1.2, 0, 0); controls.update(); }
resetCamera();
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.65, 0.5);
composer.addPass(bloom);
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
let connected = false, mode = 'draw', temporaryOrbit = false, color = '#ff36c9';
let current = null, serverOffset = 0, startedAt = Date.now(), seed = 1977, paused = false, frozenTime = 0;
const serverNow = () => Date.now() + serverOffset;
const socket = window.io({ reconnection: true });
function updateStats() {
  $('stroke-count').textContent = `${strokes.size} ${strokes.size === 1 ? 'trazo' : 'trazos'}`;
  $('undo').disabled = !connected || !Array.from(strokes.values()).some(entry => entry.data.ownerId === socket.id && entry.data.ended);
  $('clear').disabled = !connected || strokes.size === 0;
}
function disposeStroke(id) {
  const entry = strokes.get(id); if (!entry) return;
  scene.remove(entry.group);
  entry.group.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
  strokes.delete(id);
  if (current?.id === id) { current.cancelled = true; current = null; $('draw-indicator').hidden = true; }
  updateStats();
}
function clearStrokes() { for (const id of [...strokes.keys()]) disposeStroke(id); }
function addStroke(data) {
  if (strokes.has(data.id)) return strokes.get(data.id);
  const group = new THREE.Group(); scene.add(group);
  const entry = { data: { ...data, points: data.points.map(point => [...point]) }, group, dirty: true, lastBuild: 0 };
  strokes.set(data.id, entry); updateStats(); return entry;
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

socket.on('connect', () => { $('connection').textContent = 'Sincronizando'; $('connection').className = 'connecting'; });
socket.on('connect_error', () => { connected = false; $('connection').textContent = 'Reconectando'; $('connection').className = 'offline'; updateStats(); });
socket.on('disconnect', () => {
  connected = false;
  if (current) { current.cancelled = true; current.pending.length = 0; current = null; }
  $('draw-indicator').hidden = true; $('connection').textContent = 'Reconectando'; $('connection').className = 'offline'; updateStats();
  toast('Conexión interrumpida. El dibujo se reanudará al reconectar.');
});
socket.on('scene:snapshot', snapshot => {
  current = null; $('draw-indicator').hidden = true; clearStrokes();
  serverOffset = (snapshot.serverTime ?? Date.now()) - Date.now();
  seed = snapshot.seed; startedAt = snapshot.startedAt;
  for (const stroke of snapshot.strokes) if (strokeOpacity(stroke, serverNow()) > 0) addStroke(stroke);
  connected = true; $('connection').textContent = 'En vivo'; $('connection').className = ''; updatePresence(snapshot.users); updateStats();
});
function updatePresence(users) {
  $('presence').replaceChildren();
  users.slice(0, 5).forEach(user => { const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = (user.name || 'A').slice(0, 2).toUpperCase(); avatar.title = user.name + (user.id === socket.id ? ' (tú)' : ''); if (/^#[\da-f]{6}$/i.test(user.color)) { avatar.style.background = user.color + '30'; avatar.style.color = user.color; } $('presence').append(avatar); });
  $('user-count').textContent = `${users.length} en línea`;
}
socket.on('presence:update', updatePresence);
socket.on('stroke:started', stroke => { addStroke(stroke); document.querySelector('.canvas-title').classList.add('drawn'); });
socket.on('stroke:appended', ({ id, points }) => {
  const entry = strokes.get(id); if (!entry) return;
  // Sender renders append optimistically; its exact echo is consumed, not added twice.
  if (entry.echoBatches?.length && JSON.stringify(entry.echoBatches[0]) === JSON.stringify(points)) entry.echoBatches.shift();
  else { entry.data.points.push(...points); entry.dirty = true; }
});
socket.on('stroke:ended', ({ id }) => { const entry = strokes.get(id); if (entry) { entry.data.ended = true; entry.dirty = true; } updateStats(); });
socket.on('stroke:removed', ({ id }) => disposeStroke(id));
socket.on('scene:cleared', () => { clearStrokes(); toast('La sala compartida se ha limpiado.'); });

function emitChecked(event, payload, callback) {
  if (!connected || !socket.connected) return;
  const done = (error, reply) => { if (error || !reply?.ok) { toast(reply?.error || 'No se pudo guardar el cambio.'); callback?.(false, reply); } else callback?.(true, reply); };
  if (payload === undefined) socket.timeout(5000).emit(event, null, done);
  else socket.timeout(5000).emit(event, payload, done);
}
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function planePoint(event, plane) {
  const rect = canvas.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  return point && Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) <= 100 ? point.toArray() : null;
}
function syncMode() {
  const orbit = mode === 'orbit' || temporaryOrbit;
  controls.mouseButtons.LEFT = orbit ? THREE.MOUSE.ROTATE : null;
  controls.touches.ONE = orbit ? THREE.TOUCH.ROTATE : null;
  canvas.classList.toggle('orbit', orbit);
  for (const name of ['draw', 'orbit']) { $(name + '-mode').classList.toggle('active', mode === name); $(name + '-mode').setAttribute('aria-pressed', String(mode === name)); }
}
function flushStroke(stroke) {
  if (!stroke || !stroke.acknowledged || stroke.sending || stroke.cancelled || !connected) return;
  if (stroke.pending.length) {
    const points = stroke.pending.splice(0, 80);
    const entry = strokes.get(stroke.id); if (!entry) return;
    entry.echoBatches ||= []; entry.echoBatches.push(points);
    entry.data.points.push(...points); entry.dirty = true;
    stroke.sending = true;
    emitChecked('stroke:append', { id: stroke.id, points }, ok => {
      stroke.sending = false;
      if (!ok) { stroke.cancelled = true; disposeStroke(stroke.id); return; }
      flushStroke(stroke);
    });
  } else if (stroke.finished && !stroke.endSent) {
    stroke.endSent = true; emitChecked('stroke:end', { id: stroke.id }, ok => { if (!ok) disposeStroke(stroke.id); });
  }
}
function createStrokeId() {
  return crypto.randomUUID?.() || `s_${Date.now().toString(36)}_${Array.from(crypto.getRandomValues(new Uint32Array(3)), number => number.toString(36)).join('_')}`;
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || mode === 'orbit' || temporaryOrbit || current) return;
  if (!connected) { toast('Espera a conectar con la sala para dibujar.'); return; }
  event.preventDefault(); canvas.focus({ preventScroll: true });
  // Freeze the view-facing plane once. Orbit and depth changes cannot bend this stroke.
  const normal = camera.getWorldDirection(new THREE.Vector3());
  const anchor = controls.target.clone().addScaledVector(normal, Number($('depth').value));
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor);
  const point = planePoint(event, plane); if (!point) return;
  const stroke = { id: createStrokeId(), pointerId: event.pointerId, plane, pending: [], acknowledged: false, sending: false, last: point, count: 1, finished: false, cancelled: false };
  current = stroke; canvas.setPointerCapture(event.pointerId); $('draw-indicator').hidden = false;
  emitChecked('stroke:start', { id: stroke.id, color, width: Number($('width').value), point }, (ok, reply) => {
    if (stroke.cancelled || !connected) return;
    if (!ok) { stroke.cancelled = true; if (current === stroke) current = null; $('draw-indicator').hidden = true; disposeStroke(stroke.id); return; }
    addStroke(reply.stroke); stroke.acknowledged = true; flushStroke(stroke);
  });
});
canvas.addEventListener('pointermove', event => {
  const stroke = current; if (!stroke || stroke.pointerId !== event.pointerId || !connected) return;
  const events = event.getCoalescedEvents?.() || [event];
  for (const movement of events.length ? events : [event]) {
    const point = planePoint(movement, stroke.plane); if (!point) continue;
    if (new THREE.Vector3(...point).distanceTo(new THREE.Vector3(...stroke.last)) < 0.027) continue;
    if (stroke.count >= 5999) { finishStroke(); toast('Trazo completo. Empieza otro para continuar.'); break; }
    stroke.pending.push(point); stroke.last = point; stroke.count++;
  }
});
function finishStroke(event) {
  const stroke = current; if (!stroke || (event && event.pointerId !== stroke.pointerId)) return;
  stroke.finished = true; current = null; $('draw-indicator').hidden = true;
  if (canvas.hasPointerCapture(stroke.pointerId)) canvas.releasePointerCapture(stroke.pointerId);
  flushStroke(stroke);
}
canvas.addEventListener('pointerup', finishStroke);
canvas.addEventListener('pointercancel', finishStroke);
canvas.addEventListener('lostpointercapture', finishStroke);
canvas.addEventListener('contextmenu', event => event.preventDefault());
$('draw-mode').onclick = () => { finishStroke(); mode = 'draw'; syncMode(); };
$('orbit-mode').onclick = () => { finishStroke(); mode = 'orbit'; syncMode(); };
$('reset-camera').onclick = resetCamera;
$('width').oninput = () => { $('width-value').value = Number($('width').value).toFixed(3).replace(/0$/, ''); document.querySelector('.stroke-preview span').style.height = (1 + Number($('width').value) * 25) + 'px'; };
$('depth').oninput = () => { $('depth-value').value = Number($('depth').value).toFixed(1); };
document.querySelectorAll('.swatch').forEach(button => { button.onclick = () => { color = button.dataset.color; document.documentElement.style.setProperty('--accent', color); $('color-name').textContent = button.dataset.name; document.querySelectorAll('.swatch').forEach(swatch => { const selected = swatch === button; swatch.classList.toggle('selected', selected); swatch.setAttribute('aria-pressed', String(selected)); }); }; });
function undo() { finishStroke(); emitChecked('stroke:undo'); }
$('undo').onclick = undo;
$('clear').onclick = () => { if (confirm('¿Limpiar la sala compartida? Se eliminarán los trazos de TODAS las personas. Esta acción no se puede deshacer.')) { finishStroke(); emitChecked('scene:clear'); } };
$('rename').onclick = () => { const name = prompt('¿Cómo quieres aparecer en la sala?', 'Artista'); if (name?.trim()) emitChecked('presence:set', { name: name.trim().slice(0, 32) }); };
$('mesh-toggle').onclick = () => { paused = !paused; if (paused) frozenTime = (serverNow() - startedAt) / 1000; $('mesh-state').textContent = paused ? 'En pausa' : 'En movimiento'; $('mesh-toggle').textContent = paused ? '▷' : 'Ⅱ'; $('mesh-toggle').setAttribute('aria-pressed', String(paused)); $('mesh-toggle').setAttribute('aria-label', paused ? 'Reanudar forma generativa' : 'Pausar forma generativa'); };
$('collapse-tools').onclick = () => { const collapsed = document.querySelector('.tools').classList.toggle('collapsed'); $('collapse-tools').textContent = collapsed ? '+' : '−'; $('collapse-tools').setAttribute('aria-expanded', String(!collapsed)); };
function download(blob, filename) { const link = document.createElement('a'); const url = URL.createObjectURL(blob); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
$('export-json').onclick = () => { download(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), seed, startedAt, strokes: Array.from(strokes.values(), entry => entry.data) }, null, 2)], { type: 'application/json' }), 'trazo-escena.json'); toast('Escena guardada en tu dispositivo.'); };
$('export-png').onclick = () => { composer.render(); canvas.toBlob(blob => { if (blob) { download(blob, 'trazo-imagen.png'); toast('Imagen guardada en tu dispositivo.'); } else toast('No se pudo exportar la imagen.'); }, 'image/png'); };
// Arrow keys orbit directly around the target (never pan), in either tool mode.
const arrowOrbit = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
function orbitWithArrow(code) {
  finishStroke();
  const [horizontal, vertical] = arrowOrbit[code];
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta += horizontal * 0.09;
  spherical.phi = THREE.MathUtils.clamp(spherical.phi + vertical * 0.09, 0.02, Math.PI - 0.02);
  camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
  controls.update();
}
addEventListener('keydown', event => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  if (arrowOrbit[event.code] && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); orbitWithArrow(event.code); }
  else if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) { finishStroke(); temporaryOrbit = true; syncMode(); } }
  else if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); undo(); }
  else if (!event.ctrlKey && !event.metaKey && event.code === 'KeyD') { mode = 'draw'; syncMode(); }
  else if (!event.ctrlKey && !event.metaKey && event.code === 'KeyO') { finishStroke(); mode = 'orbit'; syncMode(); }
});
addEventListener('keyup', event => { if (event.code === 'Space') { temporaryOrbit = false; syncMode(); } });
addEventListener('blur', () => { finishStroke(); temporaryOrbit = false; syncMode(); });
if (innerWidth < 550) { document.querySelector('.tools').classList.add('collapsed'); $('collapse-tools').textContent = '+'; $('collapse-tools').setAttribute('aria-expanded', 'false'); }
let lastFlush = 0;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(time) {
  requestAnimationFrame(animate);
  controls.update();
  const now = serverNow();
  if (time - lastFlush > 35) { flushStroke(current); lastFlush = time; }
  for (const entry of strokes.values()) {
    const opacity = strokeOpacity(entry.data, now);
    if (opacity <= 0) { disposeStroke(entry.data.id); continue; }
    if (entry.dirty && time - entry.lastBuild > 50) { buildStroke(entry); entry.lastBuild = time; }
    if (entry.shell) { entry.shell.material.opacity = opacity * 0.78; entry.core.material.opacity = opacity; }
  }
  const t = (paused || reduceMotion) ? frozenTime : (now - startedAt) / 1000;
  form.rotation.set(0.35 + Math.sin(t * 0.09) * 0.15, t * 0.055 + seed * 0.001, Math.sin(t * 0.055) * 0.13);
  const breathing = 1 + Math.sin(t * 0.5) * 0.035; form.scale.setScalar(breathing);
  // Deformation is synchronized by shared seed and server time, never local random.
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
window.__drawingApp = {
  get strokeCount() { return strokes.size; },
  get pointCount() { return [...strokes.values()].reduce((sum, entry) => sum + entry.data.points.length, 0); },
  get connected() { return connected; }, get mode() { return mode; }, get color() { return color; },
  get depth() { return Number($('depth').value); }, get width() { return Number($('width').value); },
  get strokes() { return [...strokes.values()].map(entry => structuredClone(entry.data)); },
  get serverOffset() { return serverOffset; }, get drawing() { return !!current; },
  camera, scene, renderer, controls, socket
};
