const test = require('node:test');
const assert = require('node:assert/strict');
const checkoutGateway = require('../api/checkout-gateway');

function response() {
  const headers = new Map();
  return {
    statusCode: null,
    payload: null,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('checkout method errors are private, non-cacheable and advertise POST', async () => {
  const res = response();
  await checkoutGateway({ method: 'GET', headers: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.payload, { error: 'Método no permitido' });
  assert.equal(res.getHeader('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(res.getHeader('Allow'), 'POST');
});
