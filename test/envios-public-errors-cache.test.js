const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../api/envios.js'), 'utf8');

test('public shipping errors never expose raw internal error messages', () => {
  assert.doesNotMatch(source, /error:\s*error\?\.message/);
  assert.match(source, /publicShippingError\(error\)/);
  assert.match(source, /NO_SHIPPING_RATES/);
  assert.match(source, /DESTINATION_MISMATCH/);
  assert.match(source, /SHIPPING_NOT_CONFIGURED/);
  assert.match(source, /No se pudo procesar el envío\./);
});

test('public locality lookup can use a short shared CDN cache', () => {
  assert.match(source, /action'\) === 'localities'/);
  assert.match(source, /Cache-Control',\s*'public, max-age=0, s-maxage=1800, stale-while-revalidate=3600'/);
});

test('generic shipping capability response remains no-store', () => {
  assert.match(source, /Cache-Control',\s*'no-store, max-age=0'/);
});
