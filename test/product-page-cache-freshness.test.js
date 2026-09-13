const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'product-page.js'), 'utf8');

test('product pages prevent browser staleness and cap CDN stale serving to one minute', () => {
  const expected = 'public, max-age=0, s-maxage=60, stale-while-revalidate=60';
  assert.ok(source.split(expected).length - 1 >= 3);
  assert.doesNotMatch(source, /stale-while-revalidate=300/);
});
