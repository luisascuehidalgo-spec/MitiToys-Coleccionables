const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function headersFor(source) {
  return vercel.headers.find(rule => rule.source === source)?.headers || [];
}

function value(headers, key) {
  return headers.find(header => header.key.toLowerCase() === key.toLowerCase())?.value;
}

test('public checkout rewrite is non-cacheable in browser and CDN layers', () => {
  const headers = headersFor('/api/crear-preferencia-carrito');

  assert.equal(value(headers, 'Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(value(headers, 'CDN-Cache-Control'), 'no-store');
  assert.equal(value(headers, 'Vercel-CDN-Cache-Control'), 'no-store');
});
