const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cart = fs.readFileSync(path.join(__dirname, '..', 'carrito.js'), 'utf8');
const checkout = fs.readFileSync(path.join(__dirname, '..', 'checkout.html'), 'utf8');

test('adding to cart does not impersonate checkout start', () => {
  assert.match(cart, /track\('add_to_cart'/);
  assert.doesNotMatch(cart, /track\('checkout_started'/);
});

test('checkout and payment stages remain measured on the actual checkout page', () => {
  assert.match(checkout, /track\('checkout_view'/);
  assert.match(checkout, /track\('checkout_contact_completed'/);
  assert.match(checkout, /track\('payment_started'/);
  assert.match(checkout, /track\('payment_error'/);
});
