const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function headersFor(source) {
  const rule = config.headers.find(entry => entry.source === source);
  return Object.fromEntries((rule?.headers || []).map(header => [header.key.toLowerCase(), header.value]));
}

test('catalog rendering script cannot be served stale after a deploy', () => {
  const headers = headersFor('/catalogo-dinamico.js');
  assert.equal(headers['cache-control'], 'public, max-age=0, must-revalidate');
  assert.equal(headers['vercel-cdn-cache-control'], 'public, max-age=0, must-revalidate');
  assert.doesNotMatch(headers['vercel-cdn-cache-control'], /stale-while-revalidate/i);
});

test('non-critical static assets keep their existing edge cache policy', () => {
  for (const source of ['/catalogo.css', '/analytics.js']) {
    const headers = headersFor(source);
    assert.match(headers['vercel-cdn-cache-control'], /max-age=3600/);
    assert.match(headers['vercel-cdn-cache-control'], /stale-while-revalidate=86400/);
  }
});
