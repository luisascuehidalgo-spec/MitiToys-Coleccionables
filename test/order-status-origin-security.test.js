const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validBrowserOrigin } = require('../api/estado-pedido');

function req(headers = {}) {
  return { headers };
}

test('order status accepts same-origin HTTPS browser requests', () => {
  assert.equal(validBrowserOrigin(req({
    host: 'mititoys.com',
    origin: 'https://mititoys.com',
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'same-origin'
  })), true);
});

test('order status rejects cross-site browser requests', () => {
  assert.equal(validBrowserOrigin(req({
    host: 'mititoys.com',
    origin: 'https://example.com',
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'cross-site'
  })), false);
});

test('order status rejects null, mismatched-host and protocol-downgrade origins', () => {
  assert.equal(validBrowserOrigin(req({ host: 'mititoys.com', origin: 'null' })), false);
  assert.equal(validBrowserOrigin(req({ host: 'mititoys.com', origin: 'https://evil.example' })), false);
  assert.equal(validBrowserOrigin(req({
    host: 'mititoys.com',
    origin: 'http://mititoys.com',
    'x-forwarded-proto': 'https'
  })), false);
});

test('order status preserves non-browser tooling compatibility when origin metadata is absent', () => {
  assert.equal(validBrowserOrigin(req({ host: 'mititoys.com' })), true);
});

test('origin rejection happens before database and rate-limit work', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'estado-pedido.js'), 'utf8');
  const guard = source.indexOf('if (!validBrowserOrigin(req))');
  const database = source.indexOf('const sql = getDb()');
  const rateLimit = source.indexOf('orderStatusBlocked(sql, rateKey)');
  assert.ok(guard >= 0);
  assert.ok(database > guard);
  assert.ok(rateLimit > guard);
});

test('unsupported order status methods advertise POST without reaching database work', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'estado-pedido.js'), 'utf8');
  const methodGuard = source.indexOf("if (req.method !== 'POST')");
  const allowHeader = source.indexOf("res.setHeader('Allow', 'POST')", methodGuard);
  const database = source.indexOf('const sql = getDb()');
  assert.ok(methodGuard >= 0);
  assert.ok(allowHeader > methodGuard);
  assert.ok(database > allowHeader);
  assert.match(source, /Cache-Control', 'private, no-store, max-age=0'/);
});
