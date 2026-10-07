'use strict';
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');

const validPoint = point => Array.isArray(point) && point.length === 3 && point.every(n => Number.isFinite(n) && Math.abs(n) <= 100);

function createDrawingServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 64000 });
  const users = new Map();
  const strokes = new Map();
  const timers = new Map();
  const removeStroke = id => {
    if (!strokes.delete(id)) return;
    clearTimeout(timers.get(id)); timers.delete(id);
    io.emit('stroke:removed', { id });
  };
  const prune = () => { for (const s of strokes.values()) if (s.expiresAt <= Date.now()) removeStroke(s.id); };
  const startedAt = Date.now();
  const palette = ['#ff36c9', '#a855f7', '#22d3ee'];
  let revision = 0;
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => res.json({ ok: true, users: users.size, strokes: strokes.size }));
  app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three')));
  app.get('/output3d', (_req, res) => res.sendFile(path.join(__dirname, 'public/output3d.html')));
  app.use(express.static(path.join(__dirname, 'public')));
  io.on('connection', socket => {
    const user = { id: socket.id, name: `Artista ${users.size + 1}`, color: palette[users.size % palette.length] };
    users.set(socket.id, user);
    prune();
    socket.emit('scene:snapshot', { strokes: [...strokes.values()], users: [...users.values()], seed: 1977, startedAt, serverTime: Date.now(), revision });
    io.emit('presence:update', [...users.values()]);
    socket.on('stroke:start', (data, ack) => {
      prune();
      const fail = error => typeof ack === 'function' && ack({ ok: false, error });
      if (!data || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.id) || strokes.has(data.id) || !/^#[0-9a-f]{6}$/i.test(data.color || '') || !Number.isFinite(data.width) || data.width < 0.015 || data.width > 0.35 || !validPoint(data.point)) return fail('Trazo invalido');
      if (strokes.size >= 500) return fail('Lienzo lleno; espera a que desaparezcan algunos trazos');
      const now = Date.now();
      const stroke = { id: data.id, ownerId: socket.id, color: data.color, width: data.width, points: [data.point], ended: false, createdAt: now, expiresAt: now + 10000 };
      strokes.set(stroke.id, stroke);
      const timer = setTimeout(() => removeStroke(stroke.id), 10000);
      timer.unref(); timers.set(stroke.id, timer);
      io.emit('stroke:started', stroke);
      if (typeof ack === 'function') ack({ ok: true, stroke });
    });
    socket.on('stroke:append', (data, ack) => {
      prune();
      const stroke = strokes.get(data?.id);
      if (!stroke || stroke.ownerId !== socket.id || stroke.ended || !Array.isArray(data.points) || !data.points.length || data.points.length > 128 || !data.points.every(validPoint) || stroke.points.length + data.points.length > 6000) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Puntos invalidos o trazo ajeno' });
        return;
      }
      stroke.points.push(...data.points);
      io.emit('stroke:appended', { id: data.id, points: data.points });
      if (typeof ack === 'function') ack({ ok: true });
    });
    socket.on('stroke:end', (data, ack) => {
      prune();
      const stroke = strokes.get(data?.id);
      if (!stroke || stroke.ownerId !== socket.id) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Trazo inexistente o ajeno' });
        return;
      }
      stroke.ended = true;
      io.emit('stroke:ended', { id: data.id });
      if (typeof ack === 'function') ack({ ok: true });
    });
    socket.on('stroke:undo', (_data, ack) => {
      prune();
      const stroke = [...strokes.values()].reverse().find(s => s.ownerId === socket.id && s.ended);
      if (!stroke) { if (typeof ack === 'function') ack({ ok: false, error: 'No tienes trazos para deshacer' }); return; }
      removeStroke(stroke.id);
      if (typeof ack === 'function') ack({ ok: true });
    });
    socket.on('scene:clear', (_data, ack) => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear(); strokes.clear(); revision++;
      io.emit('scene:cleared', { revision });
      if (typeof ack === 'function') ack({ ok: true });
    });
    socket.on('presence:set', (data, ack) => {
      const name = typeof data?.name === 'string' ? data.name.replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, 28) : '';
      if (!name) { if (typeof ack === 'function') ack({ ok: false, error: 'Nombre invalido' }); return; }
      user.name = name;
      io.emit('presence:update', [...users.values()]);
      if (typeof ack === 'function') ack({ ok: true });
    });
    socket.on('disconnect', () => {
      users.delete(socket.id);
      for (const s of strokes.values()) if (s.ownerId === socket.id && !s.ended) { s.ended = true; io.emit('stroke:ended', { id: s.id }); }
      io.emit('presence:update', [...users.values()]);
    });
  });
  return { app, server, io, async close() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    const closing = new Promise(resolve => io.close(resolve));
    server.closeIdleConnections();
    await closing;
  } };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const instance = createDrawingServer();
  instance.server.listen(port, '0.0.0.0', () => console.log(`DibujoVivo 3D: http://localhost:${port}`));
  instance.server.on('error', error => { console.error(`No se pudo iniciar: ${error.message}`); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await instance.close(); process.exit(0); });
}
module.exports = { createDrawingServer };
