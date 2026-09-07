const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Regression guard: provider logs must remain metadata-only.
const PROVIDER_FILES = ['lib/shipping.js', 'api/envios.js', 'api/admin.js'];

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('los logs de Enviopack no imprimen secretos, cuerpos ni errores completos', () => {
  const forbidden = /process\.env|access_token|secret|authorization|cookie|headers|,\s*(?:data|validation|error)\s*\)|error\.message/i;
  const violations = [];
  for (const file of PROVIDER_FILES) {
    source(file).split(/\r?\n/).forEach((line, index) => {
      if (/console\.(?:log|error|warn)/.test(line) && forbidden.test(line)) {
        violations.push(`${file}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(violations, []);
});

test('errores de autenticación y cotización no filtran contenido sensible al log', async t => {
  const markers = ['log-secret-marker', 'auth-token-marker', 'test-secret-key', 'test-api-key'];
  const previousFetch = global.fetch;
  const previousError = console.error;
  const previousWarn = console.warn;
  const previousApiKey = process.env.ENVIOPACK_API_KEY;
  const previousSecret = process.env.ENVIOPACK_SECRET_KEY;
  const logs = [];

  process.env.ENVIOPACK_API_KEY = 'test-api-key';
  process.env.ENVIOPACK_SECRET_KEY = 'test-secret-key';
  console.error = (...args) => logs.push(args.map(String).join(' '));
  console.warn = (...args) => logs.push(args.map(String).join(' '));

  t.after(() => {
    global.fetch = previousFetch;
    console.error = previousError;
    console.warn = previousWarn;
    if (previousApiKey === undefined) delete process.env.ENVIOPACK_API_KEY;
    else process.env.ENVIOPACK_API_KEY = previousApiKey;
    if (previousSecret === undefined) delete process.env.ENVIOPACK_SECRET_KEY;
    else process.env.ENVIOPACK_SECRET_KEY = previousSecret;
  });

  delete require.cache[require.resolve('../lib/shipping')];
  const { quoteEnviopack } = require('../lib/shipping');

  let stage = 'auth';
  global.fetch = async url => {
    if (stage === 'auth') {
      stage = 'validation-fail';
      return { ok: true, status: 200, json: async () => ({ access_token: 'auth-token-marker' }) };
    }
    if (stage === 'validation-fail') {
      stage = 'validation-ok';
      return {
        ok: false,
        status: 502,
        json: async () => ({
          access_token: 'log-secret-marker',
          secret: 'log-secret-marker',
          authorization: 'Bearer log-secret-marker',
          message: 'log-secret-marker'
        })
      };
    }
    if (stage === 'validation-ok') {
      stage = 'quote-fail';
      return { ok: true, status: 200, json: async () => ({ valido: true }) };
    }
    return {
      ok: false,
      status: 503,
      json: async () => ({
        access_token: 'log-secret-marker',
        secret: 'log-secret-marker',
        authorization: 'Bearer log-secret-marker',
        message: 'log-secret-marker'
      })
    };
  };

  await assert.rejects(
    quoteEnviopack({ provinceCode: 'C', postalCode: '1405', packages: [{ weight: 1, height: 10, width: 10, length: 10 }] }),
    error => error.code === 'SHIPPING_PROVIDER_ERROR'
  );
  await assert.rejects(
    quoteEnviopack({ provinceCode: 'C', postalCode: '1405', packages: [{ weight: 1, height: 10, width: 10, length: 10 }] }),
    error => error.code === 'SHIPPING_PROVIDER_ERROR'
  );

  const rendered = logs.join('\n');
  for (const marker of markers) assert.ok(!rendered.includes(marker), `el log filtró ${marker}`);
  assert.match(rendered, /status=502/);
  assert.match(rendered, /status=503/);
});

test('los errores JSON de Enviopack no propagan el body del proveedor', async t => {
  const marker = 'provider-sensitive-message-marker';
  const previousFetch = global.fetch;
  const previousApiKey = process.env.ENVIOPACK_API_KEY;
  const previousSecret = process.env.ENVIOPACK_SECRET_KEY;

  process.env.ENVIOPACK_API_KEY = 'test-api-key';
  process.env.ENVIOPACK_SECRET_KEY = 'test-secret-key';

  t.after(() => {
    global.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ENVIOPACK_API_KEY;
    else process.env.ENVIOPACK_API_KEY = previousApiKey;
    if (previousSecret === undefined) delete process.env.ENVIOPACK_SECRET_KEY;
    else process.env.ENVIOPACK_SECRET_KEY = previousSecret;
  });

  delete require.cache[require.resolve('../lib/shipping')];
  const { listLocalities } = require('../lib/shipping');

  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) return { ok: true, status: 200, json: async () => ({ access_token: 'test-token' }) };
    return {
      ok: false,
      status: 500,
      json: async () => ({
        message: marker,
        access_token: marker,
        authorization: `Bearer ${marker}`
      })
    };
  };

  await assert.rejects(
    listLocalities('C'),
    error => {
      assert.equal(error.code, 'SHIPPING_PROVIDER_ERROR');
      assert.equal(error.providerStatus, 500);
      assert.equal(error.message, 'Envíopack no pudo procesar la solicitud.');
      assert.ok(!error.message.includes(marker));
      return true;
    }
  );
});

test('saldo insuficiente se clasifica sin copiar el mensaje del proveedor', async t => {
  const marker = 'saldo-provider-secret-marker';
  const previousFetch = global.fetch;
  const previousApiKey = process.env.ENVIOPACK_API_KEY;
  const previousSecret = process.env.ENVIOPACK_SECRET_KEY;

  process.env.ENVIOPACK_API_KEY = 'test-api-key';
  process.env.ENVIOPACK_SECRET_KEY = 'test-secret-key';

  t.after(() => {
    global.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ENVIOPACK_API_KEY;
    else process.env.ENVIOPACK_API_KEY = previousApiKey;
    if (previousSecret === undefined) delete process.env.ENVIOPACK_SECRET_KEY;
    else process.env.ENVIOPACK_SECRET_KEY = previousSecret;
  });

  delete require.cache[require.resolve('../lib/shipping')];
  const { listLocalities } = require('../lib/shipping');

  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) return { ok: true, status: 200, json: async () => ({ access_token: 'test-token' }) };
    return { ok: false, status: 402, json: async () => ({ mensaje: `Saldo insuficiente ${marker}` }) };
  };

  await assert.rejects(
    listLocalities('C'),
    error => {
      assert.equal(error.code, 'INSUFFICIENT_SHIPPING_BALANCE');
      assert.equal(error.providerStatus, 402);
      assert.equal(error.message, 'Envíopack informó saldo insuficiente para completar la operación.');
      assert.ok(!error.message.includes(marker));
      return true;
    }
  );
});

test('la librería no construye errores con mensajes textuales del proveedor', () => {
  const shipping = source('lib/shipping.js');
  assert.doesNotMatch(shipping, /new Error\(providerMessage/);
  assert.match(shipping, /new Error\(safeMessage\)/);
});
