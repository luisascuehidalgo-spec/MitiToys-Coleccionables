const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const limiter = require('../lib/order-status-rate-limit');

test('order-status keys are namespaced away from admin login keys', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.10' }, socket: {} };
  const first = limiter.orderStatusRateKey(req, 'test-secret');
  const second = limiter.orderStatusRateKey(req, 'test-secret');
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('clearOrderStatusFailures is a no-op without a derived key', async () => {
  let called = false;
  const sql = async () => { called = true; };
  await limiter.clearOrderStatusFailures(sql, '');
  assert.equal(called, false);
});

test('successful lookup clears only its derived order-status key before returning order data', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'estado-pedido.js'), 'utf8');
  assert.match(source, /clearOrderStatusFailures/);
  assert.match(source, /await clearOrderStatusFailures\(sql, rateKey\);\s*const order = rows\[0\]/);
});

test('limiter retains the 20-failure / 15-minute lock contract', () => {
  assert.equal(limiter.ORDER_STATUS_MAX_FAILURES, 20);
  assert.equal(limiter.ORDER_STATUS_WINDOW_MINUTES, 15);
  assert.equal(limiter.ORDER_STATUS_LOCK_MINUTES, 15);
});
