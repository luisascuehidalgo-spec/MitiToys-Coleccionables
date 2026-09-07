const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateAdminStatusTransition,
  publicOrderStatus,
  orderStatusFromPaymentEvent,
  orderStatusFromShippingEvent
} = require('../lib/order-state');
const { releaseReservedStockIfUnshipped } = require('../lib/inventory');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('estado público nunca muestra compra pagada si Mercado Pago sigue pendiente', () => {
  assert.equal(publicOrderStatus({ status: 'approved', payment_status: 'pending' }), 'pending');
  assert.equal(publicOrderStatus({ status: 'processing', payment_status: null }), 'pending');
  assert.equal(publicOrderStatus({ status: 'shipped', payment_status: 'pending' }), 'pending');
  assert.equal(publicOrderStatus({ status: 'delivered', payment_status: 'pending' }), 'pending');
});

test('estado público respeta estados definitivos y operaciones válidas', () => {
  assert.equal(publicOrderStatus({ status: 'processing', payment_status: 'approved' }), 'processing');
  assert.equal(publicOrderStatus({ status: 'pending', payment_status: 'approved' }), 'approved');
  assert.equal(publicOrderStatus({ status: 'approved', payment_status: 'refunded' }), 'refunded');
  assert.equal(publicOrderStatus({ status: 'approved', payment_status: 'charged_back' }), 'refunded');
  assert.equal(publicOrderStatus({ status: 'pending', payment_status: 'rejected' }), 'cancelled');
  assert.equal(publicOrderStatus({ status: 'cancelled', payment_status: 'pending' }), 'cancelled');
});

test('admin no puede avanzar un pedido sin pago aprobado', () => {
  for (const target of ['approved', 'processing', 'shipped', 'delivered']) {
    assert.ok(validateAdminStatusTransition({ payment_status: 'pending', payment_id: null }, target));
  }
  assert.equal(validateAdminStatusTransition({ payment_status: 'approved', payment_id: 'mp-1' }, 'processing'), null);
  assert.equal(validateAdminStatusTransition({ payment_status: 'approved', payment_id: 'mp-1' }, 'shipped'), null);
});

test('admin no puede contradecir estados definitivos de Mercado Pago', () => {
  assert.ok(validateAdminStatusTransition({ payment_status: 'approved', payment_id: 'mp-1' }, 'pending'));
  assert.ok(validateAdminStatusTransition({ payment_status: 'approved', payment_id: 'mp-1' }, 'cancelled'));
  assert.ok(validateAdminStatusTransition({ payment_status: 'pending', payment_id: 'mp-1' }, 'cancelled'));
  assert.ok(validateAdminStatusTransition({ payment_status: 'approved', payment_id: 'mp-1' }, 'refunded'));
  assert.equal(validateAdminStatusTransition({ payment_status: 'rejected', payment_id: 'mp-1' }, 'cancelled'), null);
  assert.equal(validateAdminStatusTransition({ payment_status: 'refunded', payment_id: 'mp-1' }, 'refunded'), null);
  assert.equal(validateAdminStatusTransition({ payment_status: 'pending', payment_id: null }, 'cancelled'), null);
});

test('webhook aprobado no hace retroceder fulfillment ya avanzado', () => {
  assert.equal(orderStatusFromPaymentEvent('pending', 'approved'), 'approved');
  assert.equal(orderStatusFromPaymentEvent('approved', 'approved'), 'approved');
  assert.equal(orderStatusFromPaymentEvent('processing', 'approved'), 'processing');
  assert.equal(orderStatusFromPaymentEvent('shipped', 'approved'), 'shipped');
  assert.equal(orderStatusFromPaymentEvent('delivered', 'approved'), 'delivered');
  assert.equal(orderStatusFromPaymentEvent('shipped', 'refunded'), 'refunded');
  assert.equal(orderStatusFromPaymentEvent('processing', 'rejected'), 'cancelled');
});

test('Enviopack no puede convertir un pago no aprobado en pedido operativo', () => {
  assert.equal(orderStatusFromShippingEvent({ status: 'pending', payment_status: 'pending' }, 'processing'), 'pending');
  assert.equal(orderStatusFromShippingEvent({ status: 'refunded', payment_status: 'refunded' }, 'shipped'), 'refunded');
  assert.equal(orderStatusFromShippingEvent({ status: 'cancelled', payment_status: 'rejected' }, 'delivered'), 'cancelled');
  assert.equal(orderStatusFromShippingEvent({ status: 'approved', payment_status: 'approved' }, 'processing'), 'processing');
  assert.equal(orderStatusFromShippingEvent({ status: 'processing', payment_status: 'approved' }, 'shipped'), 'shipped');
  assert.equal(orderStatusFromShippingEvent({ status: 'shipped', payment_status: 'approved' }, 'delivered'), 'delivered');
});

test('stock no vuelve al catálogo cuando el despacho ya comenzó', async () => {
  for (const shippingRow of [
    { shipping_status: 'preparing', shipping_generation_status: 'created', enviopack_shipment_id: 'ship-1' },
    { shipping_status: 'preparing', shipping_generation_status: 'processing', enviopack_shipment_id: null },
    { shipping_status: 'in_transit', shipping_generation_status: 'created', enviopack_shipment_id: null },
    { shipping_status: 'delivered', shipping_generation_status: 'created', enviopack_shipment_id: null }
  ]) {
    let calls = 0;
    const sql = async () => { calls += 1; return [shippingRow]; };
    const result = await releaseReservedStockIfUnshipped(sql, 77, 'test');
    assert.equal(result.skipped, 'shipment_started');
    assert.deepEqual(result.released, []);
    assert.equal(calls, 1);
  }
});

test('stock sí se libera antes de iniciar despacho y solo mediante release idempotente', async () => {
  let call = 0;
  const sql = async (strings) => {
    call += 1;
    const text = strings.join('?');
    if (call === 1) return [{ shipping_status: 'not_shipped', shipping_generation_status: 'not_created', enviopack_shipment_id: null }];
    if (text.startsWith('SELECT product_id,quantity FROM order_items')) return [{ product_id: '1705', quantity: 1 }];
    if (text.includes('WITH inserted_release')) {
      assert.match(text, /ON CONFLICT \(order_id,product_id,movement_type\)/);
      return [{ id: '1705', quantity: 1 }];
    }
    throw new Error('SQL inesperado: ' + text);
  };
  const result = await releaseReservedStockIfUnshipped(sql, 77, 'test');
  assert.equal(result.skipped, null);
  assert.deepEqual(result.released, [{ product_id: '1705', quantity: 1 }]);
});

test('endpoint legado de pago está retirado y no contiene lógica de cobro o stock', async () => {
  const legacy = read('api/crear-preferencia.js');
  assert.match(legacy, /LEGACY_CHECKOUT_RETIRED/);
  assert.doesNotMatch(legacy, /MERCADOPAGO_ACCESS_TOKEN/);
  assert.doesNotMatch(legacy, /stock_quantity/);
  assert.doesNotMatch(legacy, /api\.mercadopago\.com/);

  const handler = require('../api/crear-preferencia');
  const response = { statusCode: 0, headers: {}, body: null };
  const res = {
    setHeader(name, value) { response.headers[name.toLowerCase()] = value; },
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return this; }
  };
  await handler({ method: 'POST' }, res);
  assert.equal(response.statusCode, 410);
  assert.equal(response.body.code, 'LEGACY_CHECKOUT_RETIRED');
});

test('home estática no llama al endpoint legado y su fallback conduce al checkout moderno', () => {
  const home = read('index.html');
  assert.doesNotMatch(home, /fetch\(['"]\/api\/crear-preferencia['"]/);
  assert.match(home, /window\.location\.href='\/checkout\.html\?cart=1'/);
  assert.match(home, /COMPRAR \/ CALCULAR ENVÍO/);
});

test('emails usan siempre el dominio oficial de Miti Toys', () => {
  const notifications = read('lib/notifications.js');
  assert.match(notifications, /const SITE_URL = 'https:\/\/mititoys\.com';/);
  assert.doesNotMatch(notifications, /otaku-collectibles\.vercel\.app/);
});

test('API de seguimiento aplica publicOrderStatus y no loguea el error completo', () => {
  const statusApi = read('api/estado-pedido.js');
  assert.match(statusApi, /order\.status = publicOrderStatus\(order\)/);
  assert.doesNotMatch(statusApi, /console\.error\('estado-pedido error:', error\)/);
});

test('generación de Enviopack reclama y revalida el pago antes de confirmar despacho', () => {
  const admin = read('api/admin.js');
  assert.match(admin, /WHERE id=\$\{id\} AND payment_status='approved' AND enviopack_shipment_id IS NULL/);
  assert.match(admin, /const paymentGuard = await sql`SELECT status,payment_status FROM orders WHERE id=\$\{id\} LIMIT 1`/);
  assert.match(admin, /paymentGuard\[0\]\.payment_status !== 'approved'/);
  assert.match(admin, /const finalOrderStatus = orderStatusFromShippingEvent\(currentOrder, 'processing'\)/);
  assert.match(admin, /status=\$\{finalOrderStatus\}/);
  assert.match(admin, /releaseReservedStockIfUnshipped/);
});

test('notificación de despacho exige que el pago siga aprobado', () => {
  const admin = read('api/admin.js');
  const envios = read('api/envios.js');
  assert.match(admin, /updated\[0\]\?\.payment_status === 'approved'/);
  assert.match(admin, /order\.payment_status === 'approved'/);
  assert.match(envios, /orders\[0\]\.payment_status === 'approved'/);
});

test('sync automático de Enviopack respeta la verdad del pago', () => {
  const envios = read('api/envios.js');
  assert.match(envios, /SELECT id,tracking_number,status,payment_status FROM orders/);
  assert.match(envios, /orderStatusFromShippingEvent\(orders\[0\], state\.order\)/);
});

test('webhook Mercado Pago usa transición monotónica y nunca repone stock enviado', () => {
  const webhook = read('api/webhook-mercadopago.js');
  assert.match(webhook, /orderStatusFromPaymentEvent\(oldStatus, payment\.status\)/);
  assert.match(webhook, /releaseReservedStockIfUnshipped/);
  assert.doesNotMatch(webhook, /statusToOrderStatus/);
  assert.doesNotMatch(webhook, /releaseReservedStock\(sql/);
});
