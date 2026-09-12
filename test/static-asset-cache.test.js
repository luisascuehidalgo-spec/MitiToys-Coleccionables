const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function cacheHeader(source) {
  const rule = config.headers.find(entry => entry.source === source);
  return rule?.headers?.find(header => header.key.toLowerCase() === 'cache-control')?.value || '';
}

test('public static assets receive a bounded browser cache', () => {
  for (const source of ['/catalogo-dinamico.js', '/catalogo.css', '/analytics.js', '/carrito.js']) {
    assert.equal(cacheHeader(source), 'public, max-age=3600, must-revalidate');
  }
});

test('admin pages remain no-store', () => {
  assert.equal(cacheHeader('/admin.html'), 'private, no-store, max-age=0');
  assert.equal(cacheHeader('/admin-envios.html'), 'private, no-store, max-age=0');
});
