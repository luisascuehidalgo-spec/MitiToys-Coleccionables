const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authPath = require.resolve('../api/admin-auth');
const dbPath = require.resolve('../lib/db');
const ratePath = require.resolve('../lib/admin-rate-limit');

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

function request(password, ip = '203.0.113.10') {
  return {
    method: 'POST',
    body: { password },
    headers: { 'x-forwarded-for': ip }
  };
}

function makeSql() {
  const state = new Map();
  const sql = async (strings, ...values) => {
    const text = strings.join(' ');
    const key = values[0];
    if (/SELECT locked_until IS NOT NULL/.test(text)) {
      const current = state.get(key);
      return current ? [{ blocked: Boolean(current.locked) }] : [];
    }
    if (/INSERT INTO admin_login_attempts/.test(text)) {
      const current = state.get(key) || { failures: 0, locked: false };
      const failures = current.failures + 1;
      const locked = failures >= 6;
      state.set(key, { failures, locked });
      return [{ failures, locked }];
    }
    if (/DELETE FROM admin_login_attempts/.test(text)) {
      state.delete(key);
      return [];
    }
    throw new Error('Unexpected SQL in rate limit test: ' + text);
  };
  return { sql, state };
}

function loadAuth(sql) {
  delete require.cache[authPath];
  delete require.cache[ratePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { getDb: () => sql }
  };
  return require('../api/admin-auth');
}

function withAdminEnv(t) {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_PASSWORD = 'correct-password';
  process.env.ADMIN_SESSION_SECRET = 'rate-limit-unit-secret';
  t.after(() => {
    delete require.cache[authPath];
    delete require.cache[dbPath];
    delete require.cache[ratePath];
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousSecret;
  });
}

test('seis fallos en la misma IP bloquean el login durante la ventana', async t => {
  withAdminEnv(t);
  const { sql, state } = makeSql();
  const auth = loadAuth(sql);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = response();
    await auth(request('wrong-password'), res);
    assert.equal(res.statusCode, 401, `attempt ${attempt}`);
  }

  const sixth = response();
  await auth(request('wrong-password'), sixth);
  assert.equal(sixth.statusCode, 429);
  assert.equal(sixth.headers['Retry-After'], '900');
  assert.match(sixth.body.error, /Demasiados intentos/);

  const seventh = response();
  await auth(request('wrong-password'), seventh);
  assert.equal(seventh.statusCode, 429);

  const { adminLoginRateKey } = require('../lib/admin-rate-limit');
  const key = adminLoginRateKey(request('', '203.0.113.10'), process.env.ADMIN_SESSION_SECRET);
  assert.deepEqual(state.get(key), { failures: 6, locked: true });
});

test('login correcto elimina fallos previos y reinicia el contador', async t => {
  withAdminEnv(t);
  const { sql, state } = makeSql();
  const auth = loadAuth(sql);

  for (let i = 0; i < 2; i += 1) {
    const res = response();
    await auth(request('wrong-password', '198.51.100.22'), res);
    assert.equal(res.statusCode, 401);
  }

  const success = response();
  await auth(request('correct-password', '198.51.100.22'), success);
  assert.equal(success.statusCode, 200);
  assert.match(success.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict/);

  const { adminLoginRateKey } = require('../lib/admin-rate-limit');
  const key = adminLoginRateKey(request('', '198.51.100.22'), process.env.ADMIN_SESSION_SECRET);
  assert.equal(state.has(key), false);

  const nextFailure = response();
  await auth(request('wrong-password', '198.51.100.22'), nextFailure);
  assert.equal(nextFailure.statusCode, 401);
  assert.deepEqual(state.get(key), { failures: 1, locked: false });
});

test('la IP se persiste únicamente como HMAC y no en claro', () => {
  delete require.cache[ratePath];
  const { adminLoginRateKey, clientIp } = require('../lib/admin-rate-limit');
  const req = request('', '192.0.2.44, 10.0.0.1');
  assert.equal(clientIp(req), '192.0.2.44');
  const hash = adminLoginRateKey(req, 'secret-a');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(!hash.includes('192.0.2.44'));
  assert.notEqual(hash, adminLoginRateKey(req, 'secret-b'));
});

test('schema y código usan ip_hash y nunca una columna de IP en claro', () => {
  const root = path.join(__dirname, '..');
  const migration = fs.readFileSync(path.join(root, 'migrations/20260909_admin_login_rate_limit.sql'), 'utf8');
  const limiter = fs.readFileSync(path.join(root, 'lib/admin-rate-limit.js'), 'utf8');
  assert.match(migration, /ip_hash text PRIMARY KEY/);
  assert.doesNotMatch(migration, /\bip_address\b|\bclient_ip\b/);
  assert.match(limiter, /createHmac\('sha256'/);
  assert.match(limiter, /ADMIN_LOGIN_MAX_FAILURES = 6/);
  assert.match(limiter, /ADMIN_LOGIN_WINDOW_MINUTES = 15/);
  assert.match(limiter, /ADMIN_LOGIN_LOCK_MINUTES = 15/);
});
