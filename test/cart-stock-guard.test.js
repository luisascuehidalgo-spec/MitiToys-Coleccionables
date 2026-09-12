const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cartPage = fs.readFileSync(path.join(__dirname, '..', 'carrito.html'), 'utf8');

test('cart limits quantities to current purchasable stock before checkout', () => {
  assert.match(cartPage, /function maxPurchasable\(product\)/);
  assert.match(cartPage, /Math\.min\(platformLimit,Math\.max\(0,Math\.floor\(Number\(product\.stock_quantity\)\|\|0\)\)\)/);
  assert.match(cartPage, /const q=available\?Math\.min\(requested,limit\):requested/);
  assert.match(cartPage, /max="\$\{limit\}"/);
  assert.match(cartPage, /Hay un producto sin stock/);
  assert.match(cartPage, /Revisá el stock disponible antes de continuar/);
  assert.match(cartPage, /CONTINUAR AL CHECKOUT/);
});
