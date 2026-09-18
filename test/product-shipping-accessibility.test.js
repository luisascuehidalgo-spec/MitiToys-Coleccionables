const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'producto.html'), 'utf8');

test('product shipping estimator exposes accessible names and live results', () => {
  assert.match(template, /<select id="productProvince" aria-label="Provincia">/);
  assert.match(template, /<input id="productPostal"[^>]*autocomplete="postal-code"[^>]*aria-label="Código postal"/);
  assert.match(template, /<button id="productQuote" type="button">COTIZAR<\/button>/);
  assert.match(template, /<div id="productShippingResult" class="shipping-result" role="status" aria-live="polite" aria-atomic="true"><\/div>/);
});
