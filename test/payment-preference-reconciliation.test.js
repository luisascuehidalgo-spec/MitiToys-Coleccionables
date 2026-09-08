const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadPayments() {
  delete require.cache[require.resolve('../lib/payments')];
  return require('../lib/payments');
}

test('un timeout al crear preferencia se reconcilia por external_reference', async t => {
  const previousFetch = global.fetch;
  const previousToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-token';
  t.after(() => {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = previousToken;
  });

  let call = 0;
  global.fetch = async (url, options = {}) => {
    call += 1;
    if (call === 1) {
      assert.equal(String(url), 'https://api.mercadopago.com/checkout/preferences');
      assert.equal(options.method, 'POST');
      throw new Error('timeout');
    }
    if (call === 2) {
      assert.match(String(url), /checkout\/preferences\/search/);
      assert.match(String(url), /external_reference=MITITOYS-ORDER-77/);
      return {
        ok: true,
        status: 200,
        json: async () => ({ elements: [{ id: 'pref-77', external_reference: 'MITITOYS-ORDER-77' }] })
      };
    }
    assert.equal(String(url), 'https://api.mercadopago.com/checkout/preferences/pref-77');
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'pref-77', external_reference: 'MITITOYS-ORDER-77', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-77' })
    };
  };

  const { createPreferenceWithReconciliation } = loadPayments();
  const result = await createPreferenceWithReconciliation({ items: [] }, 'MITITOYS-ORDER-77');
  assert.equal(result.id, 'pref-77');
  assert.equal(result.recovered, true);
  assert.match(result.init_point, /^https:\/\/www\.mercadopago\.com\.ar\//);
  assert.equal(call, 3);
});

test('un rechazo 400 de Mercado Pago es definitivo y no dispara reconciliación', async t => {
  const previousFetch = global.fetch;
  const previousToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-token';
  t.after(() => {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = previousToken;
  });

  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: false, status: 400, json: async () => ({ message: 'invalid preference' }) };
  };

  const { createPreferenceWithReconciliation } = loadPayments();
  await assert.rejects(
    createPreferenceWithReconciliation({ items: [] }, 'MITITOYS-ORDER-88'),
    error => error.code === 'MP_PREFERENCE_CREATE_REJECTED' && error.providerStatus === 400
  );
  assert.equal(calls, 1);
});

test('si creación y búsqueda siguen indeterminadas se preserva estado incierto', async t => {
  const previousFetch = global.fetch;
  const previousToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-token';
  t.after(() => {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = previousToken;
  });

  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('connection lost');
    return { ok: true, status: 200, json: async () => ({ elements: [] }) };
  };

  const { createPreferenceWithReconciliation } = loadPayments();
  await assert.rejects(
    createPreferenceWithReconciliation({ items: [] }, 'MITITOYS-ORDER-99'),
    error => error.code === 'MP_PREFERENCE_UNCERTAIN'
  );
  assert.equal(calls, 3);
});

test('checkout no libera reserva cuando la preferencia queda incierta', () => {
  const checkout = read('api/crear-preferencia-carrito.js');
  assert.match(checkout, /createPreferenceWithReconciliation\(preference, externalReference\)/);
  assert.match(checkout, /preferenceError\?\.code !== 'MP_PREFERENCE_UNCERTAIN'/);
  assert.match(checkout, /payment_status_detail='preference_uncertain'/);
  assert.match(checkout, /status\(202\)/);
  assert.match(checkout, /pago=verificando/);
});

test('cron reconcilia preferencias ausentes antes de liberar stock', () => {
  const envios = read('api/envios.js');
  assert.match(envios, /payment_url IS NULL AND preference_id IS NULL/);
  assert.match(envios, /findPreferenceByExternalReference\(order\.external_reference\)/);
  assert.match(envios, /payment\.preference_recovered/);
  assert.match(envios, /ageMs < 2 \* 60 \* 60 \* 1000/);
  assert.match(envios, /findPaymentsByExternalReference\(order\.external_reference\)/);
  assert.match(envios, /payment\.preference_expired/);
  assert.match(envios, /Liberación por preferencia de pago no confirmada/);
  assert.match(envios, /shipping_quotes SET used_at=NULL,order_id=NULL/);
});

test('seguimiento solo expone links pendientes y HTTPS de Mercado Pago', () => {
  const tracking = read('api/estado-pedido.js');
  const page = read('pedido.html');
  assert.match(tracking, /safePendingPaymentUrl/);
  assert.match(tracking, /url\.protocol !== 'https:'/);
  assert.match(tracking, /mercadopago\.com\.ar/);
  assert.match(tracking, /PREFERENCE_TTL_MS/);
  assert.match(tracking, /order\.payment_url = safePendingPaymentUrl\(order\)/);
  assert.match(page, /CONTINUAR A MERCADO PAGO/);
  assert.match(page, /o\.payment_url/);
});
