const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { releaseReservedStock } = require('../lib/inventory');
const {
  PUBLIC_BASE_URL,
  PREFERENCE_TTL_MS,
  OFFLINE_PAYMENT_TTL_MS,
  preferenceWindow,
  findPaymentsByExternalReference,
  expirePreference
} = require('../lib/payments');
const { adminStatusError } = require('../lib/order-state');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Checkout Pro usa el dominio oficial y una vigencia explícita', () => {
  assert.equal(PUBLIC_BASE_URL, 'https://mititoys.com');
  assert.equal(PREFERENCE_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(OFFLINE_PAYMENT_TTL_MS, 3 * 24 * 60 * 60 * 1000);
  const start = new Date('2026-09-07T20:00:00.000Z');
  const window = preferenceWindow(start);
  assert.equal(window.expires, true);
  assert.equal(new Date(window.expiration_date_to) - start, PREFERENCE_TTL_MS);
  assert.equal(new Date(window.date_of_expiration) - start, OFFLINE_PAYMENT_TTL_MS);

  const checkout = read('api/crear-preferencia-carrito.js');
  assert.match(checkout, /const origin = PUBLIC_BASE_URL/);
  assert.doesNotMatch(checkout, /req\.headers\.origin/);
  assert.match(checkout, /\.\.\.preferenceWindow\(\)/);
});

test('búsqueda de pagos usa external_reference y token solo en Authorization', async t => {
  const previousToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const previousFetch = global.fetch;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'secret-test-token';
  t.after(() => {
    if (previousToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = previousToken;
    global.fetch = previousFetch;
  });

  global.fetch = async (url, options) => {
    assert.equal(url.searchParams.get('external_reference'), 'MITITOYS-ORDER-77');
    assert.equal(url.searchParams.get('limit'), '10');
    assert.ok(!url.toString().includes('secret-test-token'));
    assert.equal(options.headers.Authorization, 'Bearer secret-test-token');
    return { ok: true, json: async () => ({ results: [{ id: 123, status: 'pending' }] }) };
  };

  const results = await findPaymentsByExternalReference('MITITOYS-ORDER-77');
  assert.equal(results.length, 1);
});

test('cancelación manual invalida la preferencia y usa liberación consciente del despacho', async t => {
  const previousToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const previousFetch = global.fetch;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'secret-test-token';
  t.after(() => {
    if (previousToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = previousToken;
    global.fetch = previousFetch;
  });

  global.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.mercadopago.com/checkout/preferences/pref-123');
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers.Authorization, 'Bearer secret-test-token');
    const body = JSON.parse(options.body);
    assert.equal(body.expires, true);
    assert.equal(body.expiration_date_to, '2026-09-07T20:00:00.000Z');
    return { ok: true };
  };

  assert.equal(await expirePreference('pref-123', new Date('2026-09-07T20:00:00.000Z')), true);
  assert.match(
    adminStatusError({ currentStatus: 'approved', targetStatus: 'cancelled', paymentId: 'pay-1', paymentStatus: 'approved' }),
    /Mercado Pago/
  );
  assert.equal(
    adminStatusError({ currentStatus: 'pending', targetStatus: 'cancelled', paymentId: null, paymentStatus: 'pending' }),
    null
  );

  const admin = read('api/admin.js');
  assert.match(admin, /adminStatusError/);
  assert.match(admin, /await expirePreference\(previous\.preference_id\)/);
  assert.match(admin, /await releaseReservedStockIfUnshipped\(sql,id/);
  assert.doesNotMatch(admin, /await releaseReservedStock\(sql,id/);
});

test('liberación de inventario solo suma stock cuando se inserta el primer release', async () => {
  let releaseAttempts = 0;
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    if (text.startsWith('SELECT product_id,quantity FROM order_items')) return [{ product_id: '1705', quantity: 2 }];
    if (text.includes('WITH inserted_release')) {
      releaseAttempts += 1;
      assert.match(text, /ON CONFLICT \(order_id,product_id,movement_type\)/);
      assert.match(text, /UPDATE products p/);
      return releaseAttempts === 1 ? [{ id: '1705', quantity: 2 }] : [];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  assert.deepEqual(await releaseReservedStock(sql, 55, 'test'), [{ product_id: '1705', quantity: 2 }]);
  assert.deepEqual(await releaseReservedStock(sql, 55, 'test'), []);
});

test('cron solo vence pedidos sin payment_id y verifica Mercado Pago antes de liberar', () => {
  const envios = read('api/envios.js');
  assert.match(envios, /payment_id IS NULL/);
  assert.match(envios, /INTERVAL '26 hours'/);
  assert.match(envios, /await findPaymentsByExternalReference\(order\.external_reference\)/);
  assert.match(envios, /if \(payments\.length\)/);
  assert.match(envios, /await releaseReservedStock\(sql, order\.id, 'Liberación por checkout vencido'\)/);

  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.crons[0].schedule, '0 * * * *');
});

test('webhook reutiliza release idempotente y no imprime cuerpos completos del proveedor', () => {
  const webhook = read('api/webhook-mercadopago.js');
  assert.match(webhook, /releaseReservedStockIfUnshipped/);
  assert.doesNotMatch(webhook, /UPDATE products SET stock_quantity=stock_quantity\+/);
  assert.doesNotMatch(webhook, /console\.error\('Error consultando pago en Mercado Pago:',payment\)/);
  assert.doesNotMatch(webhook, /console\.error\('Webhook Mercado Pago error:',error\)/);
});

test('la migración impide dos release para el mismo pedido y producto', () => {
  const migration = read('database/migrations/20260907_inventory_release_idempotency.sql');
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_one_release_per_order_product/);
  assert.match(migration, /order_id, product_id, movement_type/);
  assert.match(migration, /movement_type = 'release'/);
});
