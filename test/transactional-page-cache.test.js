const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function headerValue(source, name) {
  const rule = config.headers.find(entry => entry.source === source);
  return rule?.headers?.find(header => header.key.toLowerCase() === name.toLowerCase())?.value || '';
}

test('transactional and private utility pages are not cached by browsers or shared caches', () => {
  for (const source of ['/seguimiento.html', '/pedido.html', '/carrito.html', '/checkout.html', '/opinar.html']) {
    assert.equal(headerValue(source, 'Cache-Control'), 'private, no-store, max-age=0', `${source} must remain no-store`);
  }
});
