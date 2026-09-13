const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../lib/db');
const handlerPath = require.resolve('../api/health');

function response() {
  return {
    code: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function loadHandler(sql) {
  db.getDb = () => sql;
  delete require.cache[handlerPath];
  return require('../api/health');
}

test('health exitoso devuelve solo estado mínimo, evita caché del navegador y usa caché CDN corta', async () => {
  let query = '';
  const handler = loadHandler(async strings => { query = strings.join(''); return [{ ok: 1 }]; });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal('database' in res.body, false);
  assert.equal('server_time' in res.body, false);
  assert.match(query, /SELECT 1 AS ok/);
  assert.equal(res.headers['cache-control'], 'public, max-age=0, s-maxage=15, stale-while-revalidate=30');
});

test('fallo de base nunca se cachea ni expone arquitectura o error interno', async t => {
  const previous = console.error;
  console.error = () => {};
  t.after(() => { console.error = previous; });
  const handler = loadHandler(async () => { throw Object.assign(new Error('private database detail'), { code: 'DB_TEST' }); });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 500);
  assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
  assert.deepEqual(res.body, { ok: false, error: 'Servicio temporalmente no disponible.' });
  const body = JSON.stringify(res.body);
  assert.ok(!body.includes('private database detail'));
  assert.ok(!body.toLowerCase().includes('base de datos'));
  assert.equal('database' in res.body, false);
});
