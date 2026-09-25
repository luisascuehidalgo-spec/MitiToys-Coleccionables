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

const admin = fs.readFileSync(require.resolve('../admin.html'), 'utf8');
const adminEnvios = fs.readFileSync(require.resolve('../admin-envios.html'), 'utf8');

test('admin HTML surfaces declare defense-in-depth noindex metadata', () => {
  const noindex = /<meta\s+name=["']robots["']\s+content=["']noindex,nofollow,noarchive["']\s*\/?>/i;
  assert.match(admin, noindex);
  assert.match(adminEnvios, noindex);
});
