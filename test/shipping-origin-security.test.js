const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isAllowedShippingOrigin } = require('../api/envios-gateway');

function req(headers = {}) {
  return { headers };
}

test('shipping quotes accept same-origin HTTPS requests', () => {
  assert.equal(isAllowedShippingOrigin(req({
    host: 'mititoys.com',
    origin: 'https://mititoys.com',
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'same-origin'
  })), true);
});

test('shipping quotes reject cross-site browser requests', () => {
  assert.equal(isAllowedShippingOrigin(req({
    host: 'mititoys.com',
    origin: 'https://evil.example',
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'cross-site'
  })), false);
});

test('shipping quotes reject a mismatched or null Origin', () => {
  assert.equal(isAllowedShippingOrigin(req({
    host: 'mititoys.com',
    origin: 'https://shop.example',
    'x-forwarded-proto': 'https'
  })), false);
  assert.equal(isAllowedShippingOrigin(req({
    host: 'mititoys.com',
    origin: 'null',
    'x-forwarded-proto': 'https'
  })), false);
});

test('shipping quotes reject protocol downgrade behind HTTPS proxy', () => {
  assert.equal(isAllowedShippingOrigin(req({
    host: 'mititoys.com',
    origin: 'http://mititoys.com',
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'same-origin'
  })), false);
});

test('shipping quotes preserve compatibility for non-browser tooling without Origin metadata', () => {
  assert.equal(isAllowedShippingOrigin(req({ host: 'mititoys.com' })), true);
});

test('shipping origin guard runs before rate limiting and provider quote handling', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'envios-gateway.js'), 'utf8');
  const originGuard = source.indexOf('if (!isAllowedShippingOrigin(req))');
  const rateLimit = source.indexOf('consumeShippingQuoteAttempt(getDb(), ipHash)');
  const delegate = source.indexOf('return shippingHandler(req, res);', originGuard);
  assert.ok(originGuard >= 0 && rateLimit >= 0 && delegate >= 0);
  assert.ok(originGuard < rateLimit);
  assert.ok(originGuard < delegate);
  assert.match(source, /status\(403\)/);
  assert.match(source, /SHIPPING_ORIGIN_NOT_ALLOWED/);
});
