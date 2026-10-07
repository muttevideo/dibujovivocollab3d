'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { createDrawingServer } = require('../server');
const output = path.join(__dirname, '..', 'test-results');
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const instance = createDrawingServer();
  let browser;
  const errors = [];
  try {
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${instance.server.address().port}`;
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
    const c1 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 0.5 });
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 0.5 });
    const a = await c1.newPage(), b = await c2.newPage();
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    await Promise.all([a.goto(url), b.goto(url)]);
    await Promise.all([a, b].map(p => p.waitForFunction(() => window.__drawingApp?.connected)));
    await a.waitForFunction(() => document.getElementById('user-count').textContent === '2 en línea');
    console.log('PASS: dos usuarios conectados al mismo contexto');
    async function draw(page, y = 470) {
      // Lower test-only pixel density avoids slow software-GPU frames outliving a 10s stroke.
      await page.mouse.move(610, y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(610 + i * 40, y + Math.sin(i / 1.5) * 65);
      await page.mouse.up();
      await page.waitForFunction(() => window.__drawingApp.strokes.some(s => s.ended && s.points.length > 5), null, {timeout: 4000});
    }
    await a.locator('[aria-label="Cian"]').click();
    await a.locator('#width').evaluate(el => { el.value = '0.12'; el.dispatchEvent(new Event('input')); });
    await a.locator('#depth').evaluate(el => { el.value = '3'; el.dispatchEvent(new Event('input')); });
    await draw(a);
    await b.waitForFunction(() => window.__drawingApp.pointCount > 5);
    const aStrokes = await a.evaluate(() => window.__drawingApp.strokes);
    const bStrokes = await b.evaluate(() => window.__drawingApp.strokes);
    assert.deepEqual(bStrokes, aStrokes);
    assert.equal(aStrokes[0].color, '#36eeff');
    assert.equal(aStrokes[0].width, 0.12);
    console.log(`PASS: puntero real -> ${aStrokes[0].points.length} puntos identicos, color/grosor/profundidad`);
    await a.waitForFunction(() => window.__drawingApp.scene.children.some(o => o.children.some(c => c.isMesh)));
    const geometry = await a.evaluate(() => {
      const group = window.__drawingApp.scene.children.find(o => o.children.some(c => c.isMesh));
      const positions = group.children[0].geometry.attributes.position;
      const rings = positions.count / 9;
      function ringRadius(ring) {
        const vertices = Array.from({length: 8}, (_, j) => [positions.getX(ring * 9 + j), positions.getY(ring * 9 + j), positions.getZ(ring * 9 + j)]);
        const center = [0,1,2].map(k => vertices.reduce((n,p) => n + p[k], 0) / 8);
        return Math.max(...vertices.map(p => Math.hypot(...p.map((n,k) => n - center[k]))));
      }
      return { start: ringRadius(0), middle: ringRadius(Math.floor(rings / 2)), end: ringRadius(rings - 1) };
    });
    assert.ok(geometry.start < 1e-5 && geometry.end < 1e-5);
    assert.ok(geometry.middle > 0.05);
    console.log('PASS: conicidad real en geometria', JSON.stringify(geometry));
    await a.screenshot({ path: path.join(output, 'desktop.png') });
    await b.reload(); await b.waitForFunction(() => window.__drawingApp?.connected && window.__drawingApp.strokeCount === 1);
    assert.deepEqual(await b.evaluate(() => window.__drawingApp.strokes), aStrokes);
    console.log('PASS: reconexion restaura contexto vigente');
    const cameraA = await a.evaluate(() => window.__drawingApp.camera.position.toArray());
    await b.locator('#orbit-mode').click();
    await b.mouse.move(830, 400); await b.mouse.down(); await b.mouse.move(1040, 560, { steps: 3 }); await b.mouse.up();
    await sleep(180);
    const cameraB = await b.evaluate(() => window.__drawingApp.camera.position.toArray());
    assert.notDeepEqual(cameraB, cameraA);
    assert.deepEqual(await a.evaluate(() => window.__drawingApp.camera.position.toArray()), cameraA);
    const afterOrbit = await b.evaluate(() => window.__drawingApp.strokes);
    assert.ok(afterOrbit.every(s => aStrokes.some(original => original.id === s.id)), 'orbitar no crea trazos; los anteriores pueden vencer');
    console.log('PASS: orbita real sin dibujar y camaras independientes');
    // Clear explicitly through confirmation, then create a fresh stroke for timed assertions.
    if (await a.locator('#clear').isEnabled()) { a.once('dialog', dialog => dialog.accept()); await a.locator('#clear').click(); }
    await b.waitForFunction(() => window.__drawingApp.strokeCount === 0);
    await draw(a, 520);
    const fresh = await a.evaluate(() => window.__drawingApp.strokes[0]);
    const fadeDelay = fresh.createdAt + 8300 - Date.now();
    if (fadeDelay > 0) await sleep(fadeDelay);
    const fade = await a.evaluate(() => {
      const group = window.__drawingApp.scene.children.find(o => o.children.some(c => c.isMesh));
      return group?.children[1].material.opacity;
    });
    assert.ok(fade > 0 && fade < 0.9, `opacity=${fade}`);
    await Promise.all([a,b].map(p => p.waitForFunction(() => window.__drawingApp.strokeCount === 0, null, { timeout: 5000 })));
    const elapsed = Date.now() - fresh.createdAt;
    assert.ok(elapsed >= 9900 && elapsed < 11500, `lifetime=${elapsed}`);
    console.log(`PASS: desvanecimiento opacity=${fade.toFixed(3)}, eliminacion compartida ${elapsed} ms`);
    await a.reload(); await a.waitForFunction(() => window.__drawingApp?.connected);
    assert.equal(await a.evaluate(() => window.__drawingApp.strokeCount), 0);
    await draw(a);
    await a.locator('#undo').click();
    await Promise.all([a,b].map(p => p.waitForFunction(() => window.__drawingApp.strokeCount === 0)));
    console.log('PASS: deshacer se replica');
    const downloadPromise = a.waitForEvent('download'); await a.locator('#export-png').click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, 'export.png'));
    assert.ok(fs.statSync(path.join(output, 'export.png')).size > 1000);
    console.log('PASS: exportacion PNG real');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(url); await mobile.waitForFunction(() => window.__drawingApp?.connected);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.screenshot({ path: path.join(output, 'mobile.png') });
    console.log('PASS: movil sin desbordamiento horizontal');
    assert.deepEqual(errors, []);
    console.log('PASS: sin errores JavaScript; capturas guardadas en test-results/');
  } finally {
    if (browser) await browser.close();
    await instance.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
