const test = require('node:test');
const assert = require('node:assert/strict');
const { productImagePreload } = require('../api/product-page');

test('product page preloads the first safe HTTP image', () => {
  assert.equal(
    productImagePreload(['https://res.cloudinary.com/demo/image/upload/sample.jpg', 'https://example.com/second.jpg']),
    '<https://res.cloudinary.com/demo/image/upload/sample.jpg>; rel=preload; as=image'
  );
});

test('product image preload rejects unsafe or invalid URLs', () => {
  assert.equal(productImagePreload(['javascript:alert(1)']), '');
  assert.equal(productImagePreload(['not a url']), '');
  assert.equal(productImagePreload([]), '');
});
