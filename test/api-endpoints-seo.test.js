const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function headerRule(source) {
  return config.headers.find(rule => rule.source === source);
}

test('direct API endpoints are excluded from search indexing', () => {
  const rule = headerRule('/api/(.*)');
  assert.ok(rule, 'API-wide header rule should exist');
  const robots = rule.headers.find(header => header.key.toLowerCase() === 'x-robots-tag');
  assert.equal(robots?.value, 'noindex, nofollow, noarchive');
});

test('public sitemap and product routes remain outside the API noindex source', () => {
  assert.ok(config.rewrites.some(rule => rule.source === '/sitemap.xml' && rule.destination === '/api/productos?sitemap=1'));
  assert.ok(config.rewrites.some(rule => rule.source === '/producto.html' && rule.destination === '/api/product-page'));
  assert.notEqual(headerRule('/sitemap.xml')?.headers?.find(header => header.key.toLowerCase() === 'x-robots-tag')?.value, 'noindex, nofollow, noarchive');
  assert.notEqual(headerRule('/producto.html')?.headers?.find(header => header.key.toLowerCase() === 'x-robots-tag')?.value, 'noindex, nofollow, noarchive');
});
