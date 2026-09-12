const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cartPage = fs.readFileSync(path.join(__dirname, '..', 'carrito.html'), 'utf8');

test('cart_view is emitted only once per page load', () => {
  assert.match(cartPage, /let cartViewTracked=false;/);
  assert.match(cartPage, /if\(!cartViewTracked\)\{/);
  assert.match(cartPage, /track\('cart_view',\{items:units,value:total\}\);/);
  assert.match(cartPage, /cartViewTracked=true;/);
  assert.equal((cartPage.match(/track\('cart_view'/g) || []).length, 1);
});
