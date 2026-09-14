const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const productsSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'productos.js'), 'utf8');

function headersFor(source) {
  return config.headers.find(rule => rule.source === source)?.headers || [];
}

function value(headers, key) {
  return headers.find(header => header.key.toLowerCase() === key.toLowerCase())?.value;
}

test('sitemap is browser-fresh briefly and cached longer only at CDN layers', () => {
  const headers = headersFor('/sitemap.xml');

  assert.equal(value(headers, 'Cache-Control'), 'public, max-age=300');
  assert.equal(value(headers, 'CDN-Cache-Control'), 'public, s-maxage=900, stale-while-revalidate=3600');
  assert.equal(value(headers, 'Vercel-CDN-Cache-Control'), 'public, s-maxage=900, stale-while-revalidate=3600');
});

test('catalog commercial freshness remains capped at 30 seconds', () => {
  assert.match(productsSource, /Cache-Control', 'public, max-age=0, s-maxage=30, must-revalidate'/);
  assert.equal(headersFor('/api/productos').length, 0);
});
