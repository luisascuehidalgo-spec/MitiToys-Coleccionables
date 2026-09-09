const test = require('node:test');
const assert = require('node:assert/strict');

function loadPayments() {
  delete require.cache[require.resolve('../lib/payments')];
  return require('../lib/payments');
}

test('accepts only HTTPS Mercado Pago checkout hosts', () => {
  const { safeMercadoPagoCheckoutUrl } = loadPayments();
  assert.match(safeMercadoPagoCheckoutUrl('https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=abc'), /^https:\/\/www\.mercadopago\.com\.ar\//);
  assert.match(safeMercadoPagoCheckoutUrl('https://mercadopago.com/checkout'), /^https:\/\/mercadopago\.com\//);
  assert.equal(safeMercadoPagoCheckoutUrl('http://www.mercadopago.com.ar/checkout'), '');
  assert.equal(safeMercadoPagoCheckoutUrl('https://mercadopago.com.ar.evil.test/checkout'), '');
  assert.equal(safeMercadoPagoCheckoutUrl('https://evil.test/mercadopago.com.ar'), '');
  assert.equal(safeMercadoPagoCheckoutUrl('javascript:alert(1)'), '');
  assert.equal(safeMercadoPagoCheckoutUrl('https://user@www.mercadopago.com.ar/checkout'), '');
  assert.equal(safeMercadoPagoCheckoutUrl('https://www.mercadopago.com.ar:444/checkout'), '');
});

test('createPreference does not return an invalid provider redirect URL', async t => {
  const previousFetch = global.fetch;
  const previousToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-token';
  t.after(() => {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = previousToken;
  });

  global.fetch = async () => ({
    ok: true,
    status: 201,
    json: async () => ({ id: 'pref-bad', init_point: 'https://attacker.example/pay' })
  });

  const { createPreference } = loadPayments();
  await assert.rejects(
    createPreference({ items: [] }),
    error => error.code === 'MP_PREFERENCE_CREATE_AMBIGUOUS'
  );
});

test('recovered preferences with an invalid redirect URL are ignored', async t => {
  const previousFetch = global.fetch;
  const previousToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-token';
  t.after(() => {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = previousToken;
  });

  let calls = 0;
  global.fetch = async url => {
    calls += 1;
    if (String(url).includes('/checkout/preferences/search')) {
      return { ok: true, status: 200, json: async () => ({ elements: [{ id: 'pref-1', external_reference: 'MITITOYS-ORDER-1' }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'pref-1', external_reference: 'MITITOYS-ORDER-1', init_point: 'https://mercadopago.com.ar.evil.test/checkout' })
    };
  };

  const { findPreferenceByExternalReference } = loadPayments();
  assert.equal(await findPreferenceByExternalReference('MITITOYS-ORDER-1'), null);
  assert.equal(calls, 2);
});
