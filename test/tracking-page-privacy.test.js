const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function headerMap(source) {
  const rule = config.headers.find(entry => entry.source === source);
  assert.ok(rule, `missing header rule for ${source}`);
  return Object.fromEntries(rule.headers.map(header => [header.key.toLowerCase(), header.value]));
}

test('tracking page is private, non-cacheable and excluded from crawler traversal', () => {
  const headers = headerMap('/seguimiento.html');
  assert.equal(headers['cache-control'], 'private, no-store, max-age=0');
  assert.equal(headers['x-robots-tag'], 'noindex, nofollow, noarchive');
});

test('public information pages are not accidentally covered by private tracking headers', () => {
  assert.equal(config.headers.some(entry => ['/preguntas.html', '/politicas.html'].includes(entry.source)), false);
});
