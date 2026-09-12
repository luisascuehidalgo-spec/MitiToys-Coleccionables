const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const seo = fs.readFileSync(path.join(__dirname, '..', 'lib', 'product-page-seo.js'), 'utf8');

test('product pages render server-side BreadcrumbList structured data', () => {
  assert.match(seo, /'@type': 'BreadcrumbList'/);
  assert.match(seo, /name: 'Inicio'/);
  assert.match(seo, /name: 'Figuras'/);
  assert.match(seo, /id=\"breadcrumbSchema\"/);
  assert.match(seo, /item: seo\.canonical/);
});
