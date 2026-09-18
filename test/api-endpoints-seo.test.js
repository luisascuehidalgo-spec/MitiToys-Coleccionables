const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const productsApi = fs.readFileSync(path.join(root, 'api', 'productos.js'), 'utf8');

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

test('sitemap stays dynamic and cannot be shadowed by a root static file', () => {
  assert.equal(fs.existsSync(path.join(root, 'sitemap.xml')), false, 'a static sitemap.xml would shadow the dynamic product sitemap');
  assert.match(productsApi, /SELECT id,updated_at FROM products WHERE active=true/);
  assert.match(productsApi, /producto\.html\?id=\$\{encodeURIComponent\(product\.id\)\}/);
  assert.match(productsApi, /preguntas\.html/);
  assert.match(productsApi, /politicas\.html/);
});
