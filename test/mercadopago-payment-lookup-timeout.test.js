const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function freshPayments() {
  delete require.cache[require.resolve('../lib/payments')];
  return require('../lib/payments');
}

test('getPayment usa timeout acotado y no propaga errores de transporte', async t => {
  const oldFetch = global.fetch;
  const oldToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-token';
  let capturedSignal = null;
  global.fetch = async (_url, options = {}) => {
    capturedSignal = options.signal;
    const error = new Error('provider-secret-network-error');
    error.name = 'TimeoutError';
    throw error;
  };
  t.after(() => {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = oldToken;
  });

  const { getPayment, PAYMENT_LOOKUP_TIMEOUT_MS } = freshPayments();
  assert.equal(PAYMENT_LOOKUP_TIMEOUT_MS, 6000);
  await assert.rejects(
    () => getPayment('123'),
    error => error.code === 'MP_PAYMENT_LOOKUP_FAILED'
      && error.message === 'No se pudo consultar el pago en Mercado Pago.'
      && !error.message.includes('provider-secret-network-error')
  );
  assert.ok(capturedSignal, 'La consulta de pago debe incluir AbortSignal de timeout.');
});

test('getPayment conserva solo status seguro ante respuesta HTTP fallida', async t => {
  const oldFetch = global.fetch;
  const oldToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-token';
  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ message: 'provider-sensitive-body' })
  });
  t.after(() => {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = oldToken;
  });

  const { getPayment } = freshPayments();
  await assert.rejects(
    () => getPayment('123'),
    error => error.code === 'MP_PAYMENT_LOOKUP_FAILED'
      && error.providerStatus === 503
      && !error.message.includes('provider-sensitive-body')
  );
});

test('webhook reutiliza getPayment y no hace fetch directo sin timeout', () => {
  const webhook = read('api/webhook-mercadopago.js');
  assert.match(webhook, /const \{ getPayment \} = require\('\.\.\/lib\/payments'\)/);
  assert.match(webhook, /payment = await getPayment\(dataId\)/);
  assert.doesNotMatch(webhook, /fetch\(`https:\/\/api\.mercadopago\.com\/v1\/payments\/\$\{encodeURIComponent\(dataId\)\}`/);
});
