const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CHECKOUT_MAX_ATTEMPTS,
  CHECKOUT_IP_MAX_ATTEMPTS,
  CHECKOUT_WINDOW_MINUTES,
  CHECKOUT_LOCK_MINUTES,
  checkoutRateKey,
  checkoutClientRateKey,
  checkoutClientToken,
  checkoutClientCookie
} = require('../lib/checkout-rate-limit');

const gatewaySource = fs.readFileSync(path.join(__dirname, '..', 'api', 'checkout-gateway.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function req(ip, cookie = '') {
  return { headers: { 'x-forwarded-for': ip, cookie } };
}

test('checkout IP backstop key is namespaced, deterministic and does not expose the raw IP', () => {
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

test('client key separates legitimate clients sharing an IP while retaining the IP backstop', () => {
  const secret = 'test-secret';
  const sameIp = req('203.0.113.9');
  const clientA = checkoutClientRateKey(sameIp, secret, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const clientB = checkoutClientRateKey(sameIp, secret, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

  assert.notEqual(clientA, clientB);
  assert.equal(checkoutRateKey(sameIp, secret), checkoutRateKey(req('203.0.113.9'), secret));
  assert.notEqual(checkoutClientRateKey(sameIp, secret, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), checkoutClientRateKey(req('203.0.113.10'), secret, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
});

test('checkout client cookie is opaque, HttpOnly, Secure and SameSite', () => {
  const token = 'abcdefghijklmnopqrstuvwxyzABCDEF';
  const cookie = checkoutClientCookie(token);
  assert.match(cookie, /^mt_checkout_client=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(checkoutClientToken(req('203.0.113.9', `other=x; mt_checkout_client=${token}`)), token);
  assert.equal(checkoutClientToken(req('203.0.113.9', 'mt_checkout_client=short')), '');
});

test('checkout limiter keeps a per-client budget plus a bounded IP backstop', () => {
  assert.equal(CHECKOUT_MAX_ATTEMPTS, 12);
  assert.equal(CHECKOUT_IP_MAX_ATTEMPTS, 36);
  assert.ok(CHECKOUT_IP_MAX_ATTEMPTS > CHECKOUT_MAX_ATTEMPTS);
  assert.equal(CHECKOUT_WINDOW_MINUTES, 10);
  assert.equal(CHECKOUT_LOCK_MINUTES, 10);
});

test('public checkout route applies both tiers before the original handler', () => {
  const rewrite = vercel.rewrites.find(item => item.source === '/api/crear-preferencia-carrito');
  assert.deepEqual(rewrite, {
    source: '/api/crear-preferencia-carrito',
    destination: '/api/checkout-gateway'
  });
  assert.match(gatewaySource, /consumeCheckoutAttempt\(db, clientHash\)/);
  assert.match(gatewaySource, /consumeCheckoutAttempt\(db, ipHash, CHECKOUT_IP_MAX_ATTEMPTS\)/);
  assert.match(gatewaySource, /res\.status\(429\)/);
  assert.match(gatewaySource, /Retry-After/);
  assert.match(gatewaySource, /return checkoutHandler\(req, res\)/);
});

test('rate limiter fails open without exposing secrets or request bodies', () => {
  assert.match(gatewaySource, /process\.env\.ADMIN_SESSION_SECRET/);
  assert.match(gatewaySource, /checkout rate limit unavailable:/);
  assert.doesNotMatch(gatewaySource, /console\.(?:log|warn|error)\([^\n]*(?:req\.body|ADMIN_SESSION_SECRET)/);
});
