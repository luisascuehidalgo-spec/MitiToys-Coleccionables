const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'productos.js'), 'utf8');

test('catalog list trims descriptions while product detail keeps the full description', () => {
  assert.match(source, /const catalogDescription = value =>/);
  assert.match(source, /\.slice\(0, 240\);/);
  assert.match(source, /description: productId \? product\.description : catalogDescription\(product\.description\)/);
});
