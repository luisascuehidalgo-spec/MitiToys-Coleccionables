const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../lib/db');
const handlerPath = require.resolve('../api/product-page');

function response() {
  return {
    code: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; return this; },
    end() { this.ended = true; return this; }
  };
}

function loadHandler(sql) {
  const originalGetDb = db.getDb;
  db.getDb = () => sql;
  delete require.cache[handlerPath];
  const handler = require('../api/product-page');
  db.getDb = originalGetDb;
  return handler;
}

function productRow() {
  return {
    id: '3142',
    title: 'Figura de prueba',
    description: 'Descripción de prueba',
    images: ['https://example.com/product.jpg'],
    price: '150000.00',
    stock_quantity: 3,
    stock_managed: true,
    rating: 0,
    reviews_count: 0
  };
}

test('HEAD de una ficha existente conserva headers comerciales y termina sin HTML', async () => {
  let dbCalls = 0;
  const handler = loadHandler(async () => {
    dbCalls += 1;
    return [productRow()];
  });
  const res = response();

  await handler({ method: 'HEAD', url: '/producto.html?id=3142' }, res);

  assert.equal(res.code, 200);
  assert.equal(res.ended, true);
  assert.equal(res.body, null);
  assert.equal(dbCalls, 1);
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'public, max-age=0, s-maxage=30, must-revalidate');
  assert.match(res.headers.link, /rel=preload; as=image; fetchpriority=high/);
});

test('GET de una ficha existente sigue enviando HTML', async () => {
  const handler = loadHandler(async () => [productRow()]);
  const res = response();

  await handler({ method: 'GET', url: '/producto.html?id=3142' }, res);

  assert.equal(res.code, 200);
  assert.equal(res.ended, false);
  assert.match(String(res.body), /Figura de prueba/);
  assert.equal(res.headers['cache-control'], 'public, max-age=0, s-maxage=30, must-revalidate');
});

test('HEAD sin id no abre la base y responde 200 sin cuerpo', async () => {
  let dbCalls = 0;
  const handler = loadHandler(async () => {
    dbCalls += 1;
    return [];
  });
  const res = response();

  await handler({ method: 'HEAD', url: '/producto.html' }, res);

  assert.equal(res.code, 200);
  assert.equal(res.ended, true);
  assert.equal(res.body, null);
  assert.equal(dbCalls, 0);
  assert.equal(res.headers['x-robots-tag'], 'noindex, follow');
});

test('HEAD de un producto inexistente conserva 404 y termina sin cuerpo', async () => {
  const handler = loadHandler(async () => []);
  const res = response();

  await handler({ method: 'HEAD', url: '/producto.html?id=missing' }, res);

  assert.equal(res.code, 404);
  assert.equal(res.ended, true);
  assert.equal(res.body, null);
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
});

test('métodos no soportados siguen anunciando GET y HEAD y nunca se cachean', async () => {
  let dbCalls = 0;
  const handler = loadHandler(async () => {
    dbCalls += 1;
    return [productRow()];
  });
  const res = response();

  await handler({ method: 'POST', url: '/producto.html?id=3142' }, res);

  assert.equal(res.code, 405);
  assert.equal(res.headers.allow, 'GET, HEAD');
  assert.equal(res.headers['cache-control'], 'private, no-store, max-age=0');
  assert.equal(dbCalls, 0);
});
