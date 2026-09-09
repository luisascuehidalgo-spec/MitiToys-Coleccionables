const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('../api/admin-auth');

function loadAuth() {
  delete require.cache[authPath];
  return require('../api/admin-auth');
}

function request({ method = 'POST', password, cookie } = {}) {
  return {
    method,
    body: password === undefined ? {} : { password },
    headers: cookie ? { cookie } : {}
  };
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

test('sesión firmada es válida dentro de 24h y expira del lado servidor después del TTL', () => {
  const auth = loadAuth();
  const secret = 'unit-test-session-secret';
  const issuedAt = 2_000_000_000_000;
  const token = auth.createSessionToken(secret, issuedAt);

  assert.ok(token);
  assert.equal(auth.verifySessionToken(token, secret, issuedAt), true);
  assert.equal(auth.verifySessionToken(token, secret, issuedAt + auth.ADMIN_SESSION_TTL_MS), true);
  assert.equal(auth.verifySessionToken(token, secret, issuedAt + auth.ADMIN_SESSION_TTL_MS + 1), false);
});

test('sesión demasiado futura, firma alterada o secreto distinto son rechazados', () => {
  const auth = loadAuth();
  const secret = 'unit-test-session-secret';
  const now = 2_000_000_000_000;
  const future = auth.createSessionToken(secret, now + auth.ADMIN_SESSION_FUTURE_SKEW_MS + 1);
  assert.equal(auth.verifySessionToken(future, secret, now), false);

  const valid = auth.createSessionToken(secret, now);
  const decoded = Buffer.from(valid, 'base64url').toString('utf8');
  const tampered = Buffer.from(decoded.slice(0, -1) + (decoded.endsWith('a') ? 'b' : 'a')).toString('base64url');
  assert.equal(auth.verifySessionToken(tampered, secret, now), false);
  assert.equal(auth.verifySessionToken(valid, 'other-secret', now), false);
});

test('verify valida cookie real con el mismo TTL del servidor', () => {
  const previous = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = 'cookie-test-secret';
  const auth = loadAuth();
  const realNow = Date.now();
  const token = auth.createSessionToken(process.env.ADMIN_SESSION_SECRET, realNow);
  assert.equal(auth.verify(request({ method: 'GET', cookie: `other=1; mititoys_admin=${token}; x=2` })), true);
  assert.equal(auth.ADMIN_SESSION_MAX_AGE_SECONDS * 1000, auth.ADMIN_SESSION_TTL_MS);
  if (previous === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = previous;
});

test('login exige password y session secret configurados antes de emitir cookie', async t => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  const previousError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = previousError;
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousSecret;
  });

  process.env.ADMIN_PASSWORD = 'configured-password';
  delete process.env.ADMIN_SESSION_SECRET;
  let auth = loadAuth();
  let res = response();
  await auth(request({ password: 'configured-password' }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['Set-Cookie'], undefined);
  assert.deepEqual(res.body, { error: 'Administración no disponible temporalmente.' });

  process.env.ADMIN_SESSION_SECRET = 'configured-secret';
  auth = loadAuth();
  res = response();
  await auth(request({ password: 'configured-password' }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict; Max-Age=86400/);
  assert.ok(!res.headers['Set-Cookie'].includes('configured-secret'));
  assert.ok(!res.headers['Set-Cookie'].includes('configured-password'));
});

test('comparación de password no arroja excepción con unicode de igual longitud JS pero distinto byte length', () => {
  const auth = loadAuth();
  assert.doesNotThrow(() => auth.safeEqual('á', 'a'));
  assert.equal(auth.safeEqual('á', 'a'), false);
  assert.equal(auth.safeEqual('same', 'same'), true);
});
