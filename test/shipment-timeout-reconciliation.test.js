const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function freshShipping() {
  const modulePath = require.resolve('../lib/shipping');
  delete require.cache[modulePath];
  return require('../lib/shipping');
}

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  };
}

function shipmentInput() {
  return {
    providerOrderId: '12345',
    order: {
      order_number: 'MT-TEST-1',
      shipping_destination_type: 'home',
      shipping_recipient: 'Cliente Test',
      shipping_street: 'Calle Test',
      shipping_number: '123',
      shipping_postal_code: '1405',
      shipping_province_code: 'C',
      shipping_city: 'CABA'
    },
    packages: [{ height: 10, width: 10, length: 10, weight: 1 }],
    quote: { service_code: 'N', carrier_id: 'oca', dispatch_mode: 'D' }
  };
}

test('timeout de transporte durante POST /envios queda como resultado incierto, no como fallo reintentable', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.ENVIOPACK_API_KEY;
  const oldSecret = process.env.ENVIOPACK_SECRET_KEY;
  const oldDeposit = process.env.ENVIOPACK_DEPOSIT_ID;
  process.env.ENVIOPACK_API_KEY = 'test-key';
  process.env.ENVIOPACK_SECRET_KEY = 'test-secret';
  process.env.ENVIOPACK_DEPOSIT_ID = '1';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (calls.length === 1) return response({ access_token: 'test-token' });
    const error = new Error('socket timeout');
    error.name = 'TimeoutError';
    throw error;
  };
  try {
    const { createConfirmedShipment } = freshShipping();
    await assert.rejects(
      () => createConfirmedShipment(shipmentInput()),
      error => error?.code === 'SHIPPING_PROVIDER_UNCERTAIN' && !String(error.message).includes('socket timeout')
    );
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/envios\?/);
    assert.equal(calls[1].method, 'POST');
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ENVIOPACK_API_KEY; else process.env.ENVIOPACK_API_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.ENVIOPACK_SECRET_KEY; else process.env.ENVIOPACK_SECRET_KEY = oldSecret;
    if (oldDeposit === undefined) delete process.env.ENVIOPACK_DEPOSIT_ID; else process.env.ENVIOPACK_DEPOSIT_ID = oldDeposit;
  }
});

test('POST /envios 2xx sin shipment_id o 5xx también queda incierto', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.ENVIOPACK_API_KEY;
  const oldSecret = process.env.ENVIOPACK_SECRET_KEY;
  const oldDeposit = process.env.ENVIOPACK_DEPOSIT_ID;
  process.env.ENVIOPACK_API_KEY = 'test-key';
  process.env.ENVIOPACK_SECRET_KEY = 'test-secret';
  process.env.ENVIOPACK_DEPOSIT_ID = '1';
  try {
    for (const providerResponse of [response(null, 200), response({ error: 'internal' }, 500)]) {
      let call = 0;
      global.fetch = async () => {
        call += 1;
        if (call === 1) return response({ access_token: 'test-token' });
        return providerResponse;
      };
      const { createConfirmedShipment } = freshShipping();
      await assert.rejects(
        () => createConfirmedShipment(shipmentInput()),
        error => error?.code === 'SHIPPING_PROVIDER_UNCERTAIN'
      );
      assert.equal(call, 2);
    }
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ENVIOPACK_API_KEY; else process.env.ENVIOPACK_API_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.ENVIOPACK_SECRET_KEY; else process.env.ENVIOPACK_SECRET_KEY = oldSecret;
    if (oldDeposit === undefined) delete process.env.ENVIOPACK_DEPOSIT_ID; else process.env.ENVIOPACK_DEPOSIT_ID = oldDeposit;
  }
});

test('se pueden consultar los shipments asociados al pedido para reconciliar sin crear otro', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.ENVIOPACK_API_KEY;
  const oldSecret = process.env.ENVIOPACK_SECRET_KEY;
  process.env.ENVIOPACK_API_KEY = 'test-key';
  process.env.ENVIOPACK_SECRET_KEY = 'test-secret';
  let call = 0;
  global.fetch = async (url) => {
    call += 1;
    if (call === 1) return response({ access_token: 'test-token' });
    assert.match(String(url), /\/pedidos\/12345\/envios\?/);
    return response([{ id: 7001, estado: 'E' }, { id: 7002, estado: 'P' }]);
  };
  try {
    const { listEnviopackOrderShipments } = freshShipping();
    const shipments = await listEnviopackOrderShipments('12345');
    assert.deepEqual(shipments.map(x => x.id), ['7001', '7002']);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ENVIOPACK_API_KEY; else process.env.ENVIOPACK_API_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.ENVIOPACK_SECRET_KEY; else process.env.ENVIOPACK_SECRET_KEY = oldSecret;
  }
});

test('admin bloquea el reintento automático ante resultado incierto y ofrece reconciliación', () => {
  const admin = read('api/admin.js');
  const ui = read('admin.html');
  const shipping = read('lib/shipping.js');
  const shippingSync = read('lib/shipping-sync.js');

  assert.match(shipping, /uncertainOnTransportError:\s*true/);
  assert.match(shipping, /async function listEnviopackOrderShipments/);
  assert.match(admin, /listEnviopackOrderShipments\(providerOrderId\)/);
  assert.match(admin, /shipping_generation_status='uncertain'/);
  assert.match(admin, /SHIPMENT_CREATION_UNCERTAIN/);
  assert.match(admin, /action==='reconcile_shipment'/);
  assert.match(admin, /async function reconcileShipmentCreation/);
  assert.match(admin, /return reconcileShipmentCreation\(sql, id\)/);
  assert.match(admin, /WHERE id=\$\{id\} AND enviopack_shipment_id IS NULL/);
  assert.match(shippingSync, /shipping_created_at=COALESCE\(shipping_created_at,NOW\(\)\)/);
  assert.match(admin, /shipment = providerShipmentsBefore\[0\]/);
  assert.match(admin, /let details = shipments\[0\]/);
  assert.match(admin, /persistCreatedShipment\(sql/);
  assert.match(admin, /proposedOrderStatus:\s*state\.order/);
  assert.match(admin, /proposedShippingStatus:\s*state\.shipping/);
  assert.match(shippingSync, /payment_status IS NOT DISTINCT FROM \$\{snapshot\.payment_status\}/);
  assert.match(shippingSync, /payment_status_detail IS NOT DISTINCT FROM \$\{snapshot\.payment_status_detail\}/);
  assert.match(shippingSync, /shipping_status IS NOT DISTINCT FROM \$\{snapshot\.shipping_status\}/);
  assert.match(shippingSync, /shipping_generation_status IS NOT DISTINCT FROM \$\{snapshot\.shipping_generation_status\}/);
  assert.match(admin, /SHIPMENT_RECONCILIATION_RACE/);
  assert.match(admin, /source: 'reconciliation_unique_race'/);
  assert.match(admin, /if \(!persisted\.reused\)/);
  assert.match(ui, /\['not_created','failed'\]\.includes\(String\(o\.shipping_generation_status\|\|'not_created'\)\)/);
  assert.match(ui, /reconcile_shipment/);
  assert.match(ui, /VERIFICAR EN ENVÍOPACK/);
});
