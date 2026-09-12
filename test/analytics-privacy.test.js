const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'analytics.js'), 'utf8');

function loadAnalytics() {
  const window = {};
  const context = {
    window,
    document: { addEventListener() {} },
    location: { pathname: '/' }
  };
  vm.runInNewContext(source, context);
  return window;
}

test('analytics redacts emails and phone-like digit sequences before sending', () => {
  const window = loadAnalytics();
  window.MitiToysAnalytics.track('catalog_search', {
    query: 'escribime a cliente@example.com o al +54 11 3346-6187',
    product_id: '3375'
  });

  assert.equal(window.vaq.length, 1);
  const [, event] = window.vaq[0];
  assert.equal(event.name, 'catalog_search');
  assert.equal(event.data.product_id, '3375');
  assert.doesNotMatch(event.data.query, /cliente@example\.com/);
  assert.doesNotMatch(event.data.query, /3346-6187/);
  assert.match(event.data.query, /\[redacted-email\]/);
  assert.match(event.data.query, /\[redacted-phone\]/);
});

test('analytics keeps numeric business metrics as numbers', () => {
  const window = loadAnalytics();
  window.MitiToysAnalytics.track('checkout_view', { items: 2, value: 150000 });
  const [, event] = window.vaq[0];
  assert.equal(event.data.items, 2);
  assert.equal(event.data.value, 150000);
});
