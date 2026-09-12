const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cartHelper = fs.readFileSync(path.join(__dirname, '..', 'carrito.js'), 'utf8');
const cartPage = fs.readFileSync(path.join(__dirname, '..', 'carrito.html'), 'utf8');

test('cart helper can silently prune product ids that are no longer valid', () => {
  assert.match(cartHelper, /prune\(validIds\)/);
  assert.match(cartHelper, /const next = cart\.filter\(item => allowed\.has\(item\.id\)\);/);
  const pruneStart = cartHelper.indexOf('    prune(validIds) {');
  const pruneEnd = cartHelper.indexOf('    setQty(id, qty) {', pruneStart);
  assert.ok(pruneStart >= 0 && pruneEnd > pruneStart);
  const pruneBlock = cartHelper.slice(pruneStart, pruneEnd);
  assert.doesNotMatch(pruneBlock, /MitiToysAnalytics|remove_from_cart|add_to_cart/);
});

test('cart page reconciles stale ids before rendering and checkout', () => {
  assert.match(cartPage, /const validIds=new Set\(products\.map\(p=>String\(p\.id\)\)\);/);
  assert.match(cartPage, /const cart=window\.MitiToysCart\.prune\(validIds\);/);
  assert.doesNotMatch(cartPage, /valid\.forEach\(x=>window\.MitiToysCart\.add\(x\.id,0\)\)/);
});
