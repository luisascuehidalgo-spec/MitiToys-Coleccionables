const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isUniqueViolation, persistPreferenceIdentity, shipmentConflictOwner } = require('../lib/external-identities');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('23505 se reconoce como conflicto de identidad externa', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ code: '40001' }), false);
});

test('persistencia de preference_id detecta owner previo sin mutar el pedido', async () => {
  let calls = 0;
  const sql = async (strings) => {
    calls += 1;
    const text = strings.join('?');
    assert.match(text, /SELECT id FROM orders/);
    assert.doesNotMatch(text, /UPDATE orders SET/);
    return [{ id: 91 }];
  };

  const result = await persistPreferenceIdentity(sql, {
    orderId: 77,
    preferenceId: 'pref-conflict',
    paymentUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-conflict'
  });

  assert.deepEqual(result, { ok: false, conflictOrderId: 91, skipped: false });
  assert.equal(calls, 1);
});

test('carrera UNIQUE de preference_id se convierte en conflicto controlado', async () => {
  let call = 0;
  const sql = async (strings) => {
    call += 1;
    const text = strings.join('?');
    if (call === 1) {
      assert.match(text, /SELECT id FROM orders/);
      return [];
    }
    if (call === 2) {
      assert.match(text, /UPDATE orders SET/);
      const error = new Error('duplicate key');
      error.code = '23505';
      throw error;
    }
    assert.match(text, /SELECT id FROM orders/);
    return [{ id: 92 }];
  };

  const result = await persistPreferenceIdentity(sql, {
    orderId: 77,
    preferenceId: 'pref-race',
    paymentUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-race'
  });

  assert.deepEqual(result, { ok: false, conflictOrderId: 92, skipped: false });
  assert.equal(call, 3);
});

test('reconciliación tardía no escribe sobre un pedido que dejó de estar pendiente', async () => {
  let call = 0;
  const sql = async (strings) => {
    call += 1;
    const text = strings.join('?');
    if (call === 1) {
      assert.match(text, /SELECT id FROM orders/);
      return [];
    }
    if (call === 2) {
      assert.match(text, /status='pending'/);
      assert.match(text, /payment_id IS NULL/);
      assert.match(text, /payment_url IS NULL/);
      assert.match(text, /preference_id IS NULL/);
      return [];
    }
    assert.match(text, /SELECT id,preference_id FROM orders/);
    return [{ id: 77, preference_id: null }];
  };

  const result = await persistPreferenceIdentity(sql, {
    orderId: 77,
    preferenceId: 'pref-late',
    paymentUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-late',
    pendingUnlinkedOnly: true
  });

  assert.deepEqual(result, { ok: false, conflictOrderId: null, skipped: true });
  assert.equal(call, 3);
});

test('checkout no sobrescribe un preference_id distinto ya ligado al mismo pedido', async () => {
  let call = 0;
  const sql = async (strings) => {
    call += 1;
    const text = strings.join('?');
    if (call === 1) {
      assert.match(text, /SELECT id FROM orders/);
      return [];
    }
    if (call === 2) {
      assert.match(text, /preference_id IS NULL OR preference_id=/);
      return [];
    }
    assert.match(text, /SELECT id,preference_id FROM orders/);
    return [{ id: 77, preference_id: 'pref-original' }];
  };

  const result = await persistPreferenceIdentity(sql, {
    orderId: 77,
    preferenceId: 'pref-new',
    paymentUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-new'
  });

  assert.deepEqual(result, { ok: false, conflictOrderId: null, skipped: true });
  assert.equal(call, 3);
});

test('checkout retiene la reserva ante conflicto de preference_id', () => {
  const checkout = read('api/crear-preferencia-carrito.js');
  assert.match(checkout, /persistPreferenceIdentity/);
  assert.match(checkout, /payment\.preference_ownership_conflict/);
  assert.match(checkout, /payment_status_detail='preference_ownership_conflict'/);
  assert.match(checkout, /return res\.status\(202\)/);
  assert.doesNotMatch(checkout, /preference_ownership_conflict[\s\S]{0,800}releaseReservedStock/);
});

test('cron reconcilia preference_id sin saltarse la protección UNIQUE ni la carrera de estado', () => {
  const envios = read('api/envios.js');
  assert.match(envios, /persistPreferenceIdentity/);
  assert.match(envios, /pendingUnlinkedOnly:\s*true/);
  assert.match(envios, /if \(recovered\.skipped\) continue/);
  assert.match(envios, /payment\.preference_ownership_conflict/);
  assert.match(envios, /payment_status_detail='preference_ownership_conflict'/);
  assert.doesNotMatch(envios, /UPDATE orders SET preference_id=\$\{preference\.id\}/);
});

test('23505 solo se clasifica como ownership conflict cuando el shipment pertenece a otro pedido', async () => {
  let calls = 0;
  const sqlNoOwner = async () => { calls += 1; return []; };
  assert.equal(await shipmentConflictOwner(sqlNoOwner, { code: '40001' }, 'ship-1', 77), null);
  assert.equal(calls, 0);
  assert.equal(await shipmentConflictOwner(sqlNoOwner, { code: '23505' }, null, 77), null);
  assert.equal(calls, 0);
  assert.equal(await shipmentConflictOwner(sqlNoOwner, { code: '23505' }, 'ship-1', 77), null);
  assert.equal(calls, 1);

  const sqlOtherOwner = async (strings) => {
    assert.match(strings.join('?'), /enviopack_shipment_id/);
    return [{ id: 91 }];
  };
  assert.equal(await shipmentConflictOwner(sqlOtherOwner, { code: '23505' }, 'ship-1', 77), 91);
});

test('Enviopack bloquea ownership conflict y evita un segundo despacho automático', () => {
  const admin = read('api/admin.js');
  assert.match(admin, /shipmentOwner\(sql, shipmentId, id\)/);
  assert.match(admin, /shipmentConflictOwner\(sql, error, recoveredShipmentId, id\)/);
  assert.match(admin, /if \(conflictOwner\)/);
  assert.match(admin, /shipping_generation_status='conflict'/);
  assert.match(admin, /enviopack\.shipment_ownership_conflict/);
  assert.match(admin, /SHIPMENT_OWNERSHIP_CONFLICT/);
  assert.match(admin, /if \(error\?\.code === 'SHIPMENT_OWNERSHIP_CONFLICT'\) throw error/);
});
