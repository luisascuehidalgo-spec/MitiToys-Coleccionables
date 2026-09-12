const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'carrito.js'), 'utf8');

test('checkout performs an advisory stock check before the user proceeds', () => {
  assert.match(source, /pathname\.endsWith\('\/checkout\.html'\)/);
  assert.match(source, /fetch\('\/api\/productos'/);
  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /if \(!product\.stock_managed\) return false/);
  assert.match(source, /return item\.qty > available/);
  assert.match(source, /window\.location\.replace\('\/carrito\.html'\)/);
});

test('stock warning is shown safely on the cart page', () => {
  assert.match(source, /STOCK_NOTICE_KEY/);
  assert.match(source, /pathname\.endsWith\('\/carrito\.html'\)/);
  assert.match(source, /notice\.textContent = message/);
  assert.match(source, /notice\.className = 'cart-warning'/);
});

test('network failure remains fail-open because server checkout is authoritative', () => {
  assert.match(source, /Advisory check only\. The checkout API remains the authoritative stock guard\./);
});
