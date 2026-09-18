const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../lib/db');
const handlerPath = require.resolve('../api/productos');

function response() {
  return {
    code: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; }
  };
}

function loadHandler(sql) {
  const originalGetDb = db.getDb;
  db.getDb = () => sql;
  delete require.cache[handlerPath];
  const handler = require('../api/productos');
  db.getDb = originalGetDb;
  return handler;
}

test('dynamic sitemap includes public pages and active product URLs', async () => {
  let dbCalls = 0;
  const handler = loadHandler(async () => {
    dbCalls += 1;
    return [
      { id: '3142', updated_at: '2026-09-17T12:00:00.000Z' },
      { id: 'A&B', updated_at: '2026-09-18T10:30:00.000Z' }
    ];
  });
  const res = response();

  await handler({ method: 'GET', url: '/api/productos?sitemap=1' }, res);

  assert.equal(res.code, 200);
  assert.equal(dbCalls, 1);
  assert.equal(res.headers['content-type'], 'application/xml; charset=utf-8');
  assert.match(res.headers['cache-control'], /s-maxage=3600/);
  assert.match(String(res.body), /<loc>https:\/\/mititoys\.com\/<\/loc>/);
  assert.match(String(res.body), /<loc>https:\/\/mititoys\.com\/preguntas\.html<\/loc>/);
  assert.match(String(res.body), /<loc>https:\/\/mititoys\.com\/politicas\.html<\/loc>/);
  assert.match(String(res.body), /producto\.html\?id=3142/);
  assert.match(String(res.body), /producto\.html\?id=A%26B/);
  assert.match(String(res.body), /<lastmod>2026-09-17T12:00:00\.000Z<\/lastmod>/);
  assert.doesNotMatch(String(res.body), /seguimiento\.html|checkout\.html|admin\.html/);
});
