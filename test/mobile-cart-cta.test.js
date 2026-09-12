const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cartPage = fs.readFileSync(path.join(__dirname, '..', 'carrito.html'), 'utf8');

test('mobile cart keeps a safe checkout CTA visible with the current total', () => {
  assert.match(cartPage, /body\{padding-bottom:86px\}/);
  assert.match(cartPage, /\.checkout-primary:not\(\.blocked\)\{position:fixed/);
  assert.match(cartPage, /bottom:10px/);
  assert.match(cartPage, /const checkoutClass=hasUnavailable\?'checkout-primary blocked':'checkout-primary'/);
  assert.match(cartPage, /CONTINUAR AL CHECKOUT · \$\{money\(total\)\}/);
});
