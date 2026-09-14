const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedCheckoutOrigin } = require('../api/checkout-gateway');

function req(headers = {}) {
  return { headers };
}

test('checkout accepts same-origin HTTPS requests', () => {
  assert.equal(isAllowedCheckoutOrigin(req({
    host: 'mititoys.com',
    origin: 'https://mititoys.com',
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'same-origin'
  })), true);
});

test('checkout rejects cross-site browser requests', () => {
  assert.equal(isAllowedCheckoutOrigin(req({
    host: 'mititoys.com',
    origin: 'https://evil.example',
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'cross-site'
  })), false);
});

test('checkout rejects a mismatched or null Origin', () => {
  assert.equal(isAllowedCheckoutOrigin(req({
    host: 'mititoys.com',
    origin: 'https://shop.example',
    'x-forwarded-proto': 'https'
  })), false);
  assert.equal(isAllowedCheckoutOrigin(req({
    host: 'mititoys.com',
    origin: 'null',
    'x-forwarded-proto': 'https'
  })), false);
});

test('checkout rejects protocol downgrade behind HTTPS proxy', () => {
  assert.equal(isAllowedCheckoutOrigin(req({
    host: 'mititoys.com',
    origin: 'http://mititoys.com',
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'same-origin'
  })), false);
});

test('checkout preserves compatibility for non-browser tooling without Origin metadata', () => {
  assert.equal(isAllowedCheckoutOrigin(req({ host: 'mititoys.com' })), true);
});
