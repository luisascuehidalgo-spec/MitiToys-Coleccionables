const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'product-page.js'), 'utf8');

test('product pages keep commercial price and stock fresh without serving stale CDN responses', () => {
  const expected = 'public, max-age=0, s-maxage=30, must-revalidate';
  assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /stale-while-revalidate/);
  assert.match(source, /PRODUCT_PAGE_CACHE_CONTROL/);
});
