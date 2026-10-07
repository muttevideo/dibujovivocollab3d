'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { createDrawingServer } = require('../server');
(async () => {
  const instance = createDrawingServer();
  let browser;
  const errors = [];
  try {
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${instance.server.address().port}`;
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.5 });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__drawingApp?.connected);
    const position = () => page.evaluate(() => window.__drawingApp.camera.position.toArray());
    const target = await page.evaluate(() => window.__drawingApp.controls.target.toArray());
    const distance = await page.evaluate(() => window.__drawingApp.camera.position.distanceTo(window.__drawingApp.controls.target));
    await page.locator('#canvas').focus();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const before = await position();
      await page.keyboard.press(key);
      const after = await position();
      assert.notDeepEqual(after, before, `${key} debe orbitar la cámara`);
      assert.deepEqual(await page.evaluate(() => window.__drawingApp.controls.target.toArray()), target);
      const newDistance = await page.evaluate(() => window.__drawingApp.camera.position.distanceTo(window.__drawingApp.controls.target));
      assert.ok(Math.abs(newDistance - distance) < 0.0001, 'las flechas rotan sin zoom ni pan');
    }
    assert.equal(await page.evaluate(() => window.__drawingApp.strokeCount), 0);
    console.log('PASS: las cuatro flechas orbitan sin dibujar, sin pan ni zoom');
    await page.locator('#width').focus();
    const beforeInput = await position();
    const width = await page.locator('#width').inputValue();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await position(), beforeInput, 'un slider no debe mover la cámara');
    assert.notEqual(await page.locator('#width').inputValue(), width);
    console.log('PASS: flechas en controles mantienen el comportamiento nativo');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 0.5 });
    mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto(url);
    await mobile.waitForFunction(() => window.__drawingApp?.connected);
    await mobile.locator('#collapse-tools').click();
    await mobile.locator('#orbit-mode').click();
    const cdp = await mobile.context().newCDPSession(mobile);
    async function gesture(points) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
      for (const point of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await mobile.locator('#collapse-tools').click();
    assert.equal(await mobile.evaluate(() => document.elementFromPoint(190,620)?.id), 'canvas');
    const beforeTouch = await mobile.evaluate(() => window.__drawingApp.camera.position.toArray());
    await gesture([{ x: 190, y: 620, id: 1 }, { x: 230, y: 630, id: 1 }, { x: 300, y: 690, id: 1 }]);
    await mobile.waitForTimeout(250);
    assert.notDeepEqual(await mobile.evaluate(() => window.__drawingApp.camera.position.toArray()), beforeTouch);
    assert.equal(await mobile.evaluate(() => window.__drawingApp.strokeCount), 0);
    console.log('PASS: touch de un dedo orbita sin dibujar');
    await mobile.locator('#collapse-tools').click();
    await mobile.locator('#draw-mode').click();
    await mobile.locator('#collapse-tools').click();
    await gesture([{ x: 150, y: 540, id: 1 }, { x: 180, y: 560, id: 1 }, { x: 220, y: 600, id: 1 }]);
    await mobile.waitForFunction(() => window.__drawingApp.strokes.some(s => s.ended && s.points.length >= 3));
    await page.waitForFunction(() => window.__drawingApp.strokes.some(s => s.ended && s.points.length >= 3));
    assert.deepEqual(await mobile.evaluate(() => window.__drawingApp.strokes), await page.evaluate(() => window.__drawingApp.strokes));
    console.log('PASS: dibujo touch se replica exactamente a computadora');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await instance.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
