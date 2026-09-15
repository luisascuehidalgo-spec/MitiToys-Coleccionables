const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('./api/crear-preferencia');

function responseRecorder() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    getHeader(name) { return headers.get(name.toLowerCase()); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('legacy checkout rejects unsupported methods without cacheable responses', async () => {
  const res = responseRecorder();
  await handler({ method: 'GET' }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader('allow'), 'POST');
  assert.equal(res.getHeader('cache-control'), 'private, no-store, max-age=0');
});

test('legacy checkout remains disabled for POST and is never cacheable', async () => {
  const res = responseRecorder();
  await handler({ method: 'POST' }, res);

  assert.equal(res.statusCode, 410);
  assert.equal(res.body.code, 'LEGACY_CHECKOUT_DISABLED');
  assert.equal(res.body.checkout_url, '/checkout.html?cart=1');
  assert.equal(res.getHeader('cache-control'), 'private, no-store, max-age=0');
});
