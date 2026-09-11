const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const robots = fs.readFileSync(require.resolve('../robots.txt'), 'utf8');

test('robots keeps admin surfaces and APIs out of crawler paths', () => {
  assert.match(robots, /^Disallow: \/admin\.html$/m);
  assert.match(robots, /^Disallow: \/admin-envios\.html$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
});

test('robots still advertises the canonical sitemap', () => {
  assert.match(robots, /^Sitemap: https:\/\/mititoys\.com\/sitemap\.xml$/m);
});
