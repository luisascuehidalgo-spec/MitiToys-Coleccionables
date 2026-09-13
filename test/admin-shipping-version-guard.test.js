const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'admin-shipping.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'admin-envios.html'), 'utf8');

test('admin shipping requires the product version and performs a compare-and-swap update', () => {
  assert.match(api, /ALLOWED_FIELDS = new Set\(\['id', 'updated_at'/);
  assert.match(api, /const expectedVersion = validVersion\(body\.updated_at\)/);
  assert.match(api, /date_trunc\('milliseconds',updated_at\)=date_trunc\('milliseconds',\$\{expectedVersion\}::timestamptz\)/);
  assert.match(api, /El producto cambió desde que abriste esta pantalla/);
});

test('shipping admin sends the loaded product version with each PATCH', () => {
  assert.match(panel, /updated_at:product\.updated_at/);
  assert.match(panel, /method:'PATCH'/);
});
