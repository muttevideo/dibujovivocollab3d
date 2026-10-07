'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('los lanzadores Windows trabajan desde su carpeta y comprueban Node', () => {
  for (const name of ['install.bat', 'run.bat']) {
    assert.ok(fs.existsSync(path.join(root, name)), `${name} debe existir`);
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    assert.match(source, /cd \/d "%~dp0"/i);
    assert.match(source, /where node/i);
    assert.match(source, /errorlevel/i);
  }
  assert.match(fs.readFileSync(path.join(root, 'install.bat'), 'utf8'), /call npm (ci|install)/i);
  assert.match(fs.readFileSync(path.join(root, 'run.bat'), 'utf8'), /node server\.js/i);
});
