const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'carrito.js'), 'utf8');

test('empty checkout hides the sticky mobile CTA before stock checks', () => {
  assert.match(source, /function hideEmptyCheckoutMobileCta\(\)/);
  assert.match(source, /checkout\.html'[\s\S]*read\(\)\.length/);
  assert.match(source, /mobileSubmit[\s\S]*hidden = true/);
  const init = source.match(/function init\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(init.indexOf('hideEmptyCheckoutMobileCta();') >= 0);
  assert.ok(init.indexOf('hideEmptyCheckoutMobileCta();') < init.indexOf('guardCheckoutStock();'));
});
