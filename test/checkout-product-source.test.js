const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const checkoutApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'crear-preferencia-carrito.js'), 'utf8');

test('checkout trusts only the database product record', () => {
  assert.doesNotMatch(checkoutApi, /const\s+PRODUCTOS\s*=/);
  assert.doesNotMatch(checkoutApi, /rows\[0\]\s*\|\|/);
  assert.doesNotMatch(checkoutApi, /raw\.githubusercontent\.com/);
  assert.match(checkoutApi, /const product = rows\[0\];/);
  assert.match(checkoutApi, /if \(!product\) return res\.status\(400\)\.json/);
  assert.match(checkoutApi, /let pictureUrl = '';/);
  assert.match(checkoutApi, /description: clean\(product\.description \|\| 'Figura coleccionable de anime\.'/);
});
