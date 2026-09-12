const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function robotsHeader(source) {
  const rule = vercel.headers.find(item => item.source === source);
  return rule?.headers?.find(header => header.key === 'X-Robots-Tag')?.value;
}

test('transactional and token-bearing pages stay out of search indexes', () => {
  for (const source of ['/carrito.html', '/checkout.html', '/opinar.html', '/pedido.html']) {
    assert.equal(robotsHeader(source), 'noindex, nofollow, noarchive', `${source} must be protected by X-Robots-Tag`);
  }
});
