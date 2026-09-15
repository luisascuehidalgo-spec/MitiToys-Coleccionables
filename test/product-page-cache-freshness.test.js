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

test('product page rejects unsupported methods with an explicit non-cacheable contract', () => {
  assert.match(source, /PRODUCT_PAGE_ERROR_CACHE_CONTROL = 'private, no-store, max-age=0'/);
  assert.match(source, /if \(req\.method !== 'GET' && !isHead\) \{[\s\S]*res\.setHeader\('Allow', 'GET, HEAD'\);[\s\S]*res\.setHeader\('Cache-Control', PRODUCT_PAGE_ERROR_CACHE_CONTROL\);[\s\S]*status\(405\)/);
});
