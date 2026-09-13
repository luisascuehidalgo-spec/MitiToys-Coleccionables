const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'productos.js'), 'utf8');

test('catalog price and stock responses avoid browser caching and cap CDN stale serving to one minute', () => {
  assert.match(source, /public, max-age=0, s-maxage=60, stale-while-revalidate=60/);
  assert.doesNotMatch(source, /public, max-age=0, s-maxage=60, stale-while-revalidate=300/);
});

test('long sitemap cache remains independent from commercial catalog freshness', () => {
  assert.match(source, /public, s-maxage=3600, stale-while-revalidate=86400/);
});
