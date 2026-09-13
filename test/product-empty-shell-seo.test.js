const test = require('node:test');
const assert = require('node:assert/strict');

let dbRows = [];
require('../lib/db').getDb = () => async () => dbRows;
const handler = require('../api/product-page');

async function call(url) {
  const headers = {};
  const req = { method: 'GET', url, headers: { host: 'mititoys.com' } };
  const res = {
    code: 200,
    setHeader(key, value) { headers[String(key).toLowerCase()] = String(value); },
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; return this; }
  };
  await handler(req, res);
  return { ...res, headers };
}

test('product shell without id is not indexable', async () => {
  const res = await call('/producto.html');
  assert.equal(res.code, 200);
  assert.equal(res.headers['x-robots-tag'], 'noindex, follow');
  assert.match(res.headers['cache-control'], /s-maxage=60/);
});

test('valid product detail remains indexable', async () => {
  dbRows = [{
    id: '3142',
    title: 'Producto QA',
    description: 'Detalle QA',
    images: ['https://example.com/producto.jpg'],
    price: 1000,
    stock_quantity: 1,
    stock_managed: true,
    rating: 0,
    reviews_count: 0
  }];
  const res = await call('/producto.html?id=3142');
  assert.equal(res.code, 200);
  assert.equal(res.headers['x-robots-tag'], undefined);
  assert.match(res.body, /Producto QA/);
});
