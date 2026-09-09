const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminAuth = require('../api/admin-auth');

function req(method, headers = {}) {
  return { method, headers };
}

test('mutaciones admin permiten únicamente el mismo origen del host', () => {
  const headers = {
    host: 'mititoys.com',
    origin: 'https://mititoys.com',
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'same-origin'
  };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(adminAuth.verifyMutationOrigin(req(method, headers)), true, method);
  }
});

test('same-site, cross-site, host distinto, Origin null y Origin inválido son rechazados', () => {
  assert.equal(adminAuth.verifyMutationOrigin(req('POST', {
    host: 'mititoys.com', origin: 'https://admin.mititoys.com', 'sec-fetch-site': 'same-site'
  })), false);
  assert.equal(adminAuth.verifyMutationOrigin(req('PATCH', {
    host: 'mititoys.com', origin: 'https://example.com', 'sec-fetch-site': 'cross-site'
  })), false);
  assert.equal(adminAuth.verifyMutationOrigin(req('DELETE', {
    host: 'mititoys.com', origin: 'https://otro.example', 'sec-fetch-site': 'same-origin'
  })), false);
  assert.equal(adminAuth.verifyMutationOrigin(req('POST', {
    host: 'mititoys.com', origin: 'null', 'sec-fetch-site': 'same-origin'
  })), false);
  assert.equal(adminAuth.verifyMutationOrigin(req('POST', {
    host: 'mititoys.com', origin: 'no-es-url', 'sec-fetch-site': 'same-origin'
  })), false);
});

test('protocolo reenviado debe coincidir y localhost conserva desarrollo HTTP', () => {
  assert.equal(adminAuth.verifyMutationOrigin(req('POST', {
    host: 'mititoys.com', origin: 'http://mititoys.com', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin'
  })), false);
  assert.equal(adminAuth.verifyMutationOrigin(req('POST', {
    host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin'
  })), true);
});

test('GET no se bloquea y ausencia total de metadata conserva tooling no-browser', () => {
  assert.equal(adminAuth.verifyMutationOrigin(req('GET', {
    host: 'mititoys.com', origin: 'https://example.com', 'sec-fetch-site': 'cross-site'
  })), true);
  assert.equal(adminAuth.verifyMutationOrigin(req('POST', {})), true);
  assert.equal(adminAuth.verifyMutationOrigin(req('POST', { 'sec-fetch-site': 'same-origin' })), true);
});

test('verify combina firma de sesión y guard de origen para APIs admin', () => {
  const previous = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = 'test-session-secret';
  try {
    const token = adminAuth.createSessionToken(process.env.ADMIN_SESSION_SECRET, Date.now());
    const cookie = `mititoys_admin=${token}`;
    assert.equal(adminAuth.verify(req('PATCH', {
      cookie,
      host: 'mititoys.com',
      origin: 'https://mititoys.com',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    })), true);
    assert.equal(adminAuth.verify(req('PATCH', {
      cookie,
      host: 'mititoys.com',
      origin: 'https://evil.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'cross-site'
    })), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previous;
  }
});

test('todas las APIs admin protegidas siguen delegando autenticación al verify central', () => {
  const root = path.join(__dirname, '..');
  for (const file of ['api/admin.js', 'api/admin-product.js', 'api/admin-shipping.js', 'api/admin-image.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /require\(['"]\.\/admin-auth['"]\)/, file);
    assert.match(source, /verify\(req\)/, file);
  }
  const authSource = fs.readFileSync(path.join(root, 'api/admin-auth.js'), 'utf8');
  assert.match(authSource, /verifyMutationOrigin\(req\)/);
  assert.match(authSource, /status\(403\)/);
});
