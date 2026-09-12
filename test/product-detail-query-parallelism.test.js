const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'productos.js'), 'utf8');

test('product detail starts reviews lookup before awaiting the product query', () => {
  const reviewsPromise = source.indexOf('const reviewsPromise = productId');
  const productsQuery = source.indexOf('const products = productId');
  const reviewsAwait = source.indexOf('const reviews = reviewsPromise ? await reviewsPromise : [];');

  assert.notEqual(reviewsPromise, -1);
  assert.notEqual(productsQuery, -1);
  assert.notEqual(reviewsAwait, -1);
  assert.ok(reviewsPromise < productsQuery, 'reviews lookup should start before the product query is awaited');
  assert.ok(productsQuery < reviewsAwait, 'reviews should only be awaited after the product query completes');
});
