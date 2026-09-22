const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CHECKOUT_MAX_ATTEMPTS,
  CHECKOUT_WINDOW_MINUTES,
  CHECKOUT_LOCK_MINUTES,
  checkoutRateKey
} = require('../lib/checkout-rate-limit');

const gatewaySource = fs.readFileSync(path.join(__dirname, '..', 'api', 'checkout-gateway.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function req(ip) {
  return { headers: { 'x-forwarded-for': ip } };
}

test('checkout rate key is namespaced, deterministic and does not expose the raw IP', () => {
  const secret = 'test-secret';
  const first = checkoutRateKey(req('203.0.113.9'), secret);
  const second = checkoutRateKey(req('203.0.113.9'), secret);
  const other = checkoutRateKey(req('203.0.113.10'), secret);

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /203\.0\.113\.9/);
  assert.equal(checkoutRateKey(req('203.0.113.9'), ''), '');
});

test('checkout limiter uses a bounded conservative window', () => {
  assert.equal(CHECKOUT_MAX_ATTEMPTS, 12);
  assert.equal(CHECKOUT_WINDOW_MINUTES, 10);
  assert.equal(CHECKOUT_LOCK_MINUTES, 10);
});

test('shared-IP clients currently collide on the same checkout budget', () => {
  const secret = 'test-secret';
  const natIp = '203.0.113.44';
  const clientA = { headers: { 'x-forwarded-for': natIp }, body: { email: 'a@example.test', cart: [{ id: 1 }] } };
  const clientB = { headers: { 'x-forwarded-for': natIp }, body: { email: 'b@example.test', cart: [{ id: 2 }] } };

  assert.equal(checkoutRateKey(clientA, secret), checkoutRateKey(clientB, secret));
  assert.equal(CHECKOUT_MAX_ATTEMPTS, 12);
});

test('client-controlled checkout fields cannot rotate the current backstop key', () => {
  const secret = 'test-secret';
  const ip = '203.0.113.45';
  const first = { headers: { 'x-forwarded-for': ip }, body: { email: 'first@example.test', cart: [{ id: 10 }] } };
  const rotated = { headers: { 'x-forwarded-for': ip }, body: { email: 'rotated@example.test', cart: [{ id: 999 }] } };

  assert.equal(checkoutRateKey(first, secret), checkoutRateKey(rotated, secret));
});

test('public checkout route is gated before the original handler', () => {
  const rewrite = vercel.rewrites.find(item => item.source === '/api/crear-preferencia-carrito');
  assert.deepEqual(rewrite, {
    source: '/api/crear-preferencia-carrito',
    destination: '/api/checkout-gateway'
  });
  assert.match(gatewaySource, /consumeCheckoutAttempt\(getDb\(\), ipHash\)/);
  assert.match(gatewaySource, /res\.status\(429\)/);
  assert.match(gatewaySource, /Retry-After/);
  assert.match(gatewaySource, /return checkoutHandler\(req, res\)/);
});

test('rate limiter fails open without exposing secrets or request bodies', () => {
  assert.match(gatewaySource, /process\.env\.ADMIN_SESSION_SECRET/);
  assert.match(gatewaySource, /checkout rate limit unavailable:/);
  assert.doesNotMatch(gatewaySource, /console\.(?:log|warn|error)\([^\n]*(?:req\.body|ADMIN_SESSION_SECRET)/);
});
