const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('../api/admin-auth');
const dbPath = require.resolve('../lib/db');

function loadAuth(sql) {
  delete require.cache[authPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { getDb: () => sql }
  };
  return require('../api/admin-auth');
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function authSql() {
  return async strings => {
    const text = strings.join(' ');
    if (/SELECT locked_until IS NOT NULL/.test(text)) return [];
    if (/DELETE FROM admin_login_attempts/.test(text)) return [];
    throw new Error('Unexpected SQL in host cookie test: ' + text);
  };
}

test('admin login emits a __Host cookie and never caches authentication responses', async t => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  t.after(() => {
    delete require.cache[authPath];
    delete require.cache[dbPath];
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousSecret;
  });

  process.env.ADMIN_PASSWORD = 'host-cookie-password';
  process.env.ADMIN_SESSION_SECRET = 'host-cookie-secret';
  const auth = loadAuth(authSql());
  const res = response();
  await auth({ method: 'POST', body: { password: process.env.ADMIN_PASSWORD }, headers: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Set-Cookie'], /^__Host-mititoys_admin=/);
  assert.match(res.headers['Set-Cookie'], /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400$/);
  assert.doesNotMatch(res.headers['Set-Cookie'], /Domain=/i);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
});

test('verification prefers the host-only cookie while accepting the legacy cookie during migration', () => {
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = 'migration-secret';
  const auth = loadAuth(authSql());
  const token = auth.createSessionToken(process.env.ADMIN_SESSION_SECRET, Date.now());

  assert.equal(auth.verify({ method: 'GET', headers: { cookie: `__Host-mititoys_admin=${token}` } }), true);
  assert.equal(auth.verify({ method: 'GET', headers: { cookie: `mititoys_admin=${token}` } }), true);

  if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = previousSecret;
  delete require.cache[authPath];
  delete require.cache[dbPath];
});

test('logout clears both the host-only cookie and the legacy migration cookie', async () => {
  const auth = loadAuth(authSql());
  const res = response();
  await auth({ method: 'DELETE', body: {}, headers: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.headers['Set-Cookie']));
  assert.equal(res.headers['Set-Cookie'].length, 2);
  assert.match(res.headers['Set-Cookie'][0], /^__Host-mititoys_admin=;/);
  assert.match(res.headers['Set-Cookie'][1], /^mititoys_admin=;/);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
});
