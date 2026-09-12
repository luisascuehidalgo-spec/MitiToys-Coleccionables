const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function headerValue(source, name) {
  const rule = config.headers.find(entry => entry.source === source);
  return rule?.headers?.find(header => header.key.toLowerCase() === name.toLowerCase())?.value || '';
}

test('public static assets revalidate in browsers while Vercel CDN keeps a bounded cache', () => {
  for (const source of ['/catalogo-dinamico.js', '/catalogo.css', '/analytics.js', '/carrito.js']) {
    assert.equal(headerValue(source, 'Cache-Control'), 'public, max-age=0, must-revalidate');
    assert.equal(headerValue(source, 'Vercel-CDN-Cache-Control'), 'public, max-age=3600, stale-while-revalidate=86400');
  }
});

test('admin pages remain no-store', () => {
  assert.equal(headerValue('/admin.html', 'Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(headerValue('/admin-envios.html', 'Cache-Control'), 'private, no-store, max-age=0');
});
