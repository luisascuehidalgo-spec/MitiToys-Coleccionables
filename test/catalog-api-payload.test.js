const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'productos.js'), 'utf8');

test('catalog responses keep only the primary image while product detail keeps the gallery', () => {
  assert.match(api, /const imageLimit = productId \? 8 : 1;/);
  assert.match(api, /slice\(0, imageLimit\)/);
});
