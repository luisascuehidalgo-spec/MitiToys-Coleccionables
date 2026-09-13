const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'product-page.js'), 'utf8');

test('product pages prevent browser staleness while keeping short CDN caching', () => {
  assert.match(source, /public, max-age=0, must-revalidate/);
  assert.match(source, /Vercel-CDN-Cache-Control/);
  assert.match(source, /max-age=60, stale-while-revalidate=60/);
  assert.doesNotMatch(source, /stale-while-revalidate=300/);
});
