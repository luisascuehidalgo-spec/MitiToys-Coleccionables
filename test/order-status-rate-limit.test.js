const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  ORDER_STATUS_MAX_FAILURES,
  ORDER_STATUS_WINDOW_MINUTES,
  ORDER_STATUS_LOCK_MINUTES,
  orderStatusRateKey,
  orderStatusBlocked,
  recordOrderStatusFailure
} = require('../lib/order-status-rate-limit');

const endpointSource = fs.readFileSync(require.resolve('../api/estado-pedido.js'), 'utf8');

test('order tracking rate key is scoped HMAC and never exposes the client IP', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.42' } };
  const key = orderStatusRateKey(req, 'test-secret');
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.ok(!key.includes('203.0.113.42'));
  assert.notEqual(key, require('../lib/admin-rate-limit').adminLoginRateKey(req, 'test-secret'));
});

test('order tracking uses a deliberately generous customer-facing threshold', () => {
  assert.equal(ORDER_STATUS_MAX_FAILURES, 20);
  assert.equal(ORDER_STATUS_WINDOW_MINUTES, 15);
  assert.equal(ORDER_STATUS_LOCK_MINUTES, 15);
});

test('empty rate key fails open without writing tracking data', async () => {
  const sql = () => assert.fail('database should not be called');
  assert.equal(await orderStatusBlocked(sql, ''), false);
  assert.deepEqual(await recordOrderStatusFailure(sql, ''), { failures: 0, locked: false });
});

test('rate-limit storage results are normalized', async () => {
  const blockedSql = async () => [{ blocked: true }];
  assert.equal(await orderStatusBlocked(blockedSql, 'hash'), true);
  const recordSql = async () => [{ failures: 20, locked: true }];
  assert.deepEqual(await recordOrderStatusFailure(recordSql, 'hash'), { failures: 20, locked: true });
});

test('endpoint checks active lock before querying an order and records only failed matches', () => {
  const blockedAt = endpointSource.indexOf('orderStatusBlocked(sql, rateKey)');
  const orderSelectAt = endpointSource.indexOf('FROM orders o JOIN customers c');
  const recordAt = endpointSource.indexOf('recordOrderStatusFailure(sql, rateKey)');
  const noRowsAt = endpointSource.indexOf('if (!rows.length)');
  assert.ok(blockedAt > 0 && orderSelectAt > blockedAt);
  assert.ok(recordAt > noRowsAt && recordAt > orderSelectAt);
  assert.match(endpointSource, /Retry-After/);
  assert.match(endpointSource, /status\(429\)/);
});

test('endpoint preserves a single generic mismatch response', () => {
  assert.match(endpointSource, /No encontramos un pedido que coincida con ese número y email\./);
  assert.doesNotMatch(endpointSource, /pedido existe|email incorrecto|correo incorrecto/i);
});
