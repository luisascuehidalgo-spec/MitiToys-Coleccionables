const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = fs.readFileSync(path.join(__dirname, '..', 'catalogo-dinamico.js'), 'utf8');

test('catalog cards render only the primary product image', () => {
  assert.match(catalog, /const primaryImage = images\[0\];/);
  assert.doesNotMatch(catalog, /images\.map\(\(url, imageIndex\)/);
  assert.doesNotMatch(catalog, /<div class=\"thumbs\">/);
  assert.doesNotMatch(catalog, /querySelectorAll\('\.thumbwrap'\)/);
  assert.match(catalog, /fetchpriority=\"low\"/);
  assert.match(catalog, /href=\"\/producto\.html\?id=/);
});
