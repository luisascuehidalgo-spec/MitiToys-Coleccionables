const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'carrito.js'), 'utf8');

test('cart bootstrap no longer scans retired static catalog cards', () => {
  assert.doesNotMatch(source, /addButtonsToExistingCards/);
  assert.doesNotMatch(source, /querySelectorAll\('#catalogo \.card'\)/);
  const initBody = source.match(/function init\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(initBody, /updateBadges\(\)/);
  assert.doesNotMatch(initBody, /#catalogo \.card/);
});

test('cart functionality and badge updates remain available', () => {
  assert.match(source, /window\.MitiToysCart = \{/);
  assert.match(source, /add\(id, qty = 1\)/);
  assert.match(source, /remove\(id\)/);
  assert.match(source, /setQty\(id, qty\)/);
  assert.match(source, /const updateBadges = \(\) =>/);
  assert.match(source, /window\.addEventListener\('storage'/);
});
