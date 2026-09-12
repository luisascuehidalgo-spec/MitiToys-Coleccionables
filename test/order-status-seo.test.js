const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

test('private order status page is excluded from search indexing', () => {
  const rule = vercel.headers.find(entry => entry.source === '/pedido.html');
  const robots = rule?.headers?.find(header => header.key === 'X-Robots-Tag');
  assert.equal(robots?.value, 'noindex, nofollow, noarchive');
});
