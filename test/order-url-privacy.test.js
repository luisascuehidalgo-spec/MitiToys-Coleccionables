const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'pedido.html'), 'utf8');

test('order status page removes order number from the visible URL before verification', () => {
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /const q=new URLSearchParams\(location\.search\),n=q\.get\('pedido'\)/);
  assert.match(html, /if\(n\)history\.replaceState\(null,'',location\.pathname\)/);
  assert.match(html, /body:JSON\.stringify\(\{pedido:n,email\}\)/);
});
