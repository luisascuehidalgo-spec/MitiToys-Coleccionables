const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalogJs = fs.readFileSync(path.join(__dirname, '..', 'catalogo-dinamico.js'), 'utf8');
const catalogCss = fs.readFileSync(path.join(__dirname, '..', 'catalogo.css'), 'utf8');

test('catalog assets do not retain retired card gallery code', () => {
  assert.doesNotMatch(catalogJs, /function prepareExistingCards/);
  assert.doesNotMatch(catalogCss, /\.thumbs/);
  assert.doesNotMatch(catalogCss, /\.thumbwrap/);
  assert.doesNotMatch(catalogCss, /\.pay-now/);
  assert.doesNotMatch(catalogCss, /\.catalog-whatsapp/);
  assert.match(catalogJs, /function renderProduct/);
  assert.match(catalogCss, /\.catalog-detail/);
  assert.match(catalogCss, /\.cart-add/);
});
