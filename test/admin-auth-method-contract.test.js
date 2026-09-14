const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../api/admin-auth');

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('admin auth 405 advertises POST/DELETE and remains private no-store', async () => {
  const res = response();
  await auth({ method: 'GET', headers: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST, DELETE');
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.deepEqual(res.body, { error: 'Método no permitido' });
});
