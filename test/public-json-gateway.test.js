const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const checkoutPath = path.join(root, 'api', 'checkout-gateway.js');
const shippingPath = path.join(root, 'api', 'envios-gateway.js');
const checkoutSource = fs.readFileSync(checkoutPath, 'utf8');
const shippingSource = fs.readFileSync(shippingPath, 'utf8');
const checkoutGateway = require(checkoutPath);
const shippingGateway = require(shippingPath);

function request(contentType) {
  return { headers: contentType ? { 'content-type': contentType } : {} };
}

test('public state-changing gateways accept JSON including charset and reject simple form content types', () => {
  for (const isJsonRequest of [checkoutGateway.isJsonRequest, shippingGateway.isJsonRequest]) {
    assert.equal(isJsonRequest(request('application/json')), true);
    assert.equal(isJsonRequest(request('application/json; charset=utf-8')), true);
    assert.equal(isJsonRequest(request('application/x-www-form-urlencoded')), false);
    assert.equal(isJsonRequest(request('multipart/form-data; boundary=test')), false);
    assert.equal(isJsonRequest(request('text/plain')), false);
    assert.equal(isJsonRequest(request()), false);
  }
});

test('checkout rejects non-JSON before consuming the IP rate limit', () => {
  const guard = checkoutSource.indexOf('if (!isJsonRequest(req))');
  const consume = checkoutSource.indexOf('consumeCheckoutAttempt(getDb(), ipHash)');
  assert.ok(guard >= 0 && consume >= 0 && guard < consume);
  assert.match(checkoutSource, /status\(415\)/);
  assert.match(checkoutSource, /CHECKOUT_JSON_REQUIRED/);
});

test('shipping quote rejects non-JSON before consuming the IP rate limit', () => {
  const guard = shippingSource.indexOf('if (!isJsonRequest(req))');
  const consume = shippingSource.indexOf('consumeShippingQuoteAttempt(getDb(), ipHash)');
  assert.ok(guard >= 0 && consume >= 0 && guard < consume);
  assert.match(shippingSource, /status\(415\)/);
  assert.match(shippingSource, /SHIPPING_QUOTE_JSON_REQUIRED/);
});
