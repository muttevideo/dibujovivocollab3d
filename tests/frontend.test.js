const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { pathToFileURL } = require('node:url');
const math = () => import(pathToFileURL(path.join(root, 'public/drawing-math.mjs')));
test('strokes fade smoothly in their final three seconds and expire at ten seconds', async () => {
  const { strokeOpacity } = await math();
  const stroke = { createdAt: 1000, expiresAt: 11000 };
  assert.equal(strokeOpacity(stroke, 1000), 1);
  assert.equal(strokeOpacity(stroke, 8000), 1);
  assert.equal(strokeOpacity(stroke, 9500), 0.5);
  assert.equal(strokeOpacity(stroke, 11000), 0);
  assert.equal(strokeOpacity(stroke, 13000), 0);
});
test('taper has pointed ends, a full middle, and clamps outside the path', async () => {
  const { taperRadius } = await math();
  assert.equal(typeof taperRadius, 'function');
  assert.equal(taperRadius(0), 0);
  assert.equal(taperRadius(1), 0);
  assert.equal(taperRadius(0.5), 1);
  assert.ok(taperRadius(0.03) > 0 && taperRadius(0.03) < 1);
  assert.equal(taperRadius(-1), 0);
});
test('drawing client implements authoritative streaming, snapshot replacement, exports and WebGL fallback', () => {
  const file = path.join(root, 'public/app.js');
  assert.ok(fs.existsSync(file), 'interactive client must exist');
  const app = fs.readFileSync(file, 'utf8');
  for (const event of ['scene:snapshot', 'presence:update', 'stroke:start', 'stroke:append', 'stroke:end', 'stroke:started', 'stroke:appended', 'stroke:ended', 'stroke:removed', 'scene:cleared']) assert.ok(app.includes(event), event);
  for (const feature of ['serverTime', 'strokeOpacity', 'taperRadius', 'confirm(', '__drawingApp', 'setPointerCapture', 'textContent', 'UnrealBloomPass', 'download', 'ray.intersectPlane']) assert.ok(app.includes(feature), feature);
  assert.match(app, /if \(!connected/);
});
test('LAN drawing supports insecure origins and sends explicit null for no-data acknowledgments', () => {
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  assert.ok(app.includes('createStrokeId()'));
  assert.ok(app.includes('crypto.randomUUID?.()'));
  assert.match(app, /emit\(event, null, done\)/);
});
test('Spanish workspace serves local dependencies and accessible drawing controls', () => {
  assert.ok(fs.existsSync(path.join(root, 'public/index.html')), 'drawing workspace must exist');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /lang="es"/);
  assert.match(html, /\/vendor\/three\/build\/three.module.js/);
  assert.match(html, /\/socket.io\/socket.io.js/);
  for (const id of ['canvas', 'depth', 'width', 'draw-mode', 'orbit-mode', 'presence', 'connection', 'undo', 'clear', 'export-png', 'export-json', 'fatal']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /https?:\/\//);
});
