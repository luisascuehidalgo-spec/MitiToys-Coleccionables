const test = require('node:test');
const assert = require('node:assert/strict');

const { productImagePreload } = require('../api/product-page');

test('product image preload accepts HTTPS with high priority and rejects insecure or malformed URLs', () => {
  assert.equal(
    productImagePreload(['https://res.cloudinary.com/demo/image/upload/example.jpg']),
    '<https://res.cloudinary.com/demo/image/upload/example.jpg>; rel=preload; as=image; fetchpriority=high'
  );
  assert.equal(productImagePreload(['http://example.com/image.jpg']), '');
  assert.equal(productImagePreload(['javascript:alert(1)']), '');
  assert.equal(productImagePreload(['not-a-url']), '');
  assert.equal(productImagePreload([]), '');
});
