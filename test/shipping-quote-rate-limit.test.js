const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SHIPPING_QUOTE_MAX_ATTEMPTS,
  SHIPPING_QUOTE_WINDOW_MINUTES,
  SHIPPING_QUOTE_LOCK_MINUTES,
  shippingQuoteRateKey
} = require('../lib/shipping-quote-rate-limit');

const gatewaySource = fs.readFileSync(path.join(__dirname, '..', 'api', 'envios-gateway.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function req(ip) {
  return { headers: { 'x-forwarded-for': ip } };
}

test('shipping quote rate key is namespaced, deterministic and hides the raw IP', () => {
  const secret = 'test-secret';
  const first = shippingQuoteRateKey(req('203.0.113.9'), secret);
  const second = shippingQuoteRateKey(req('203.0.113.9'), secret);
  const other = shippingQuoteRateKey(req('203.0.113.10'), secret);

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /203\.0\.113\.9/);
  assert.equal(shippingQuoteRateKey(req('203.0.113.9'), ''), '');
});

test('shipping quote limiter allows normal browsing while bounding provider abuse', () => {
  assert.equal(SHIPPING_QUOTE_MAX_ATTEMPTS, 30);
  assert.equal(SHIPPING_QUOTE_WINDOW_MINUTES, 10);
  assert.equal(SHIPPING_QUOTE_LOCK_MINUTES, 10);
});

test('public shipping route is gated before Enviopack and GET behavior remains delegated', () => {
  const rewrite = vercel.rewrites.find(item => item.source === '/api/envios');
  assert.deepEqual(rewrite, {
    source: '/api/envios',
    destination: '/api/envios-gateway'
  });
  assert.match(gatewaySource, /if \(req\.method !== 'POST'\) return shippingHandler\(req, res\)/);
  assert.match(gatewaySource, /consumeShippingQuoteAttempt\(getDb\(\), ipHash\)/);
  assert.match(gatewaySource, /res\.status\(429\)/);
  assert.match(gatewaySource, /Retry-After/);
  assert.match(gatewaySource, /return shippingHandler\(req, res\)/);
});

test('shipping quote limiter fails open without logging secrets or request bodies', () => {
  assert.match(gatewaySource, /process\.env\.ADMIN_SESSION_SECRET/);
  assert.match(gatewaySource, /shipping quote rate limit unavailable:/);
  assert.doesNotMatch(gatewaySource, /console\.(?:log|warn|error)\([^\n]*(?:req\.body|ADMIN_SESSION_SECRET)/);
});
