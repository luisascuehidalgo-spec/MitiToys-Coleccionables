const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  orderStatusFromPayment,
  publicOrderStatus,
  orderStatusFromShipping,
  shippingStatusFromProvider,
  adminStatusError,
  adminStatusOptions
} = require('../lib/order-state');
const { releaseReservedStockIfUnshipped } = require('../lib/inventory');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('webhooks aprobados no retroceden preparación, envío o entrega', () => {
  assert.equal(orderStatusFromPayment('approved', 'approved'), 'approved');
  assert.equal(orderStatusFromPayment('processing', 'approved'), 'processing');
  assert.equal(orderStatusFromPayment('shipped', 'approved'), 'shipped');
  assert.equal(orderStatusFromPayment('delivered', 'approved'), 'delivered');
});

test('notificaciones pendientes no degradan un pedido que ya avanzó internamente', () => {
  assert.equal(orderStatusFromPayment('approved', 'pending'), 'approved');
  assert.equal(orderStatusFromPayment('processing', 'in_process'), 'processing');
  assert.equal(orderStatusFromPayment('shipped', 'pending'), 'shipped');
});

test('estado público exige verdad de Mercado Pago aunque exista un estado histórico inconsistente', () => {
  assert.equal(publicOrderStatus({ status: 'approved', payment_status: 'pending' }), 'pending');
  assert.equal(publicOrderStatus({ status: 'processing', payment_status: 'validation_failed' }), 'pending');
  assert.equal(publicOrderStatus({ status: 'shipped', payment_status: null }), 'pending');
  assert.equal(publicOrderStatus({ status: 'processing', payment_status: 'approved' }), 'processing');
  assert.equal(publicOrderStatus({ status: 'pending', payment_status: 'approved' }), 'approved');
  assert.equal(publicOrderStatus({ status: 'shipped', payment_status: 'refunded' }), 'refunded');
  assert.equal(publicOrderStatus({ status: 'processing', payment_status: 'rejected' }), 'cancelled');
});

test('estados terminales del proveedor prevalecen sin resucitar un reembolso', () => {
  assert.equal(orderStatusFromPayment('processing', 'rejected'), 'cancelled');
  assert.equal(orderStatusFromPayment('shipped', 'refunded'), 'refunded');
  assert.equal(orderStatusFromPayment('refunded', 'rejected'), 'refunded');
  assert.equal(orderStatusFromPayment('refunded', 'approved'), 'refunded');
});

test('Enviopack solo avanza fulfillment con pago aprobado y nunca retrocede', () => {
  assert.equal(orderStatusFromShipping({ status: 'pending', payment_status: 'pending' }, 'processing'), 'pending');
  assert.equal(orderStatusFromShipping({ status: 'approved', payment_status: 'approved' }, 'processing'), 'processing');
  assert.equal(orderStatusFromShipping({ status: 'processing', payment_status: 'approved' }, 'shipped'), 'shipped');
  assert.equal(orderStatusFromShipping({ status: 'shipped', payment_status: 'approved' }, 'processing'), 'shipped');
  assert.equal(orderStatusFromShipping({ status: 'delivered', payment_status: 'approved' }, 'shipped'), 'delivered');
  assert.equal(orderStatusFromShipping({ status: 'shipped', payment_status: 'pending' }, 'processing'), 'shipped');
  assert.equal(orderStatusFromShipping({ status: 'refunded', payment_status: 'refunded' }, 'delivered'), 'refunded');
  assert.equal(orderStatusFromShipping({ status: 'cancelled', payment_status: 'rejected' }, 'shipped'), 'cancelled');
  assert.equal(orderStatusFromShipping({ status: 'cancelled', payment_status: 'approved' }, 'delivered'), 'cancelled');
  assert.equal(orderStatusFromShipping({ status: 'refunded', payment_status: 'approved' }, 'processing'), 'refunded');
});

test('estado logístico de Enviopack no retrocede por respuestas transitorias débiles', () => {
  assert.equal(shippingStatusFromProvider('delivered', 'preparing'), 'delivered');
  assert.equal(shippingStatusFromProvider('in_transit', 'preparing'), 'in_transit');
  assert.equal(shippingStatusFromProvider('exception', 'preparing'), 'exception');
  assert.equal(shippingStatusFromProvider('preparing', 'in_transit'), 'in_transit');
  assert.equal(shippingStatusFromProvider('in_transit', 'delivered'), 'delivered');
});

test('admin no puede avanzar una compra sin pago aprobado', () => {
  for (const targetStatus of ['approved', 'processing', 'shipped', 'delivered']) {
    assert.match(
      adminStatusError({ currentStatus: 'pending', targetStatus, paymentId: null, paymentStatus: 'pending' }),
      /Mercado Pago/
    );
  }
  assert.equal(
    adminStatusError({ currentStatus: 'approved', targetStatus: 'processing', paymentId: 'p1', paymentStatus: 'approved' }),
    null
  );
});

test('admin respeta cancelación, reembolso y estados definitivos confirmados', () => {
  assert.match(
    adminStatusError({ currentStatus: 'approved', targetStatus: 'refunded', paymentId: 'p1', paymentStatus: 'approved' }),
    /reembolso/
  );
  assert.equal(
    adminStatusError({ currentStatus: 'approved', targetStatus: 'refunded', paymentId: 'p1', paymentStatus: 'refunded' }),
    null
  );
  assert.match(
    adminStatusError({ currentStatus: 'approved', targetStatus: 'cancelled', paymentId: 'p1', paymentStatus: 'approved' }),
    /Mercado Pago/
  );
  assert.equal(
    adminStatusError({ currentStatus: 'pending', targetStatus: 'cancelled', paymentId: null, paymentStatus: 'pending' }),
    null
  );
  assert.match(
    adminStatusError({ currentStatus: 'cancelled', targetStatus: 'pending', paymentId: 'p1', paymentStatus: 'rejected' }),
    /estado definitivo/
  );
});

test('opciones del admin dependen del estado real del pago', () => {
  assert.deepEqual(
    adminStatusOptions({ status: 'pending', payment_status: 'pending', payment_id: null }).sort(),
    ['cancelled', 'pending']
  );
  assert.deepEqual(
    adminStatusOptions({ status: 'approved', payment_status: 'approved', payment_id: 'p1' }).sort(),
    ['approved', 'delivered', 'processing', 'shipped']
  );
});

test('stock no vuelve al catálogo una vez iniciado el despacho', async () => {
  for (const shippingRow of [
    { shipping_status: 'preparing', shipping_generation_status: 'processing', enviopack_shipment_id: null },
    { shipping_status: 'preparing', shipping_generation_status: 'created', enviopack_shipment_id: null },
    { shipping_status: 'in_transit', shipping_generation_status: 'created', enviopack_shipment_id: 'ship-1' },
    { shipping_status: 'delivered', shipping_generation_status: 'created', enviopack_shipment_id: 'ship-1' }
  ]) {
    let calls = 0;
    const sql = async () => { calls += 1; return [shippingRow]; };
    const result = await releaseReservedStockIfUnshipped(sql, 77, 'test');
    assert.deepEqual(result, { released: [], skipped: 'shipment_started' });
    assert.equal(calls, 1);
  }
});

test('stock sí puede liberarse si la generación abortó antes de crear envío', async () => {
  let call = 0;
  const sql = async strings => {
    call += 1;
    const text = strings.join('?');
    if (call === 1) return [{ shipping_status: 'not_shipped', shipping_generation_status: 'failed', enviopack_shipment_id: null }];
    if (text.startsWith('SELECT product_id,quantity FROM order_items')) return [{ product_id: '1705', quantity: 1 }];
    if (text.includes('WITH inserted_release')) return [{ id: '1705', quantity: 1 }];
    throw new Error('SQL inesperado: ' + text);
  };
  assert.deepEqual(
    await releaseReservedStockIfUnshipped(sql, 77, 'test'),
    { released: [{ product_id: '1705', quantity: 1 }], skipped: null }
  );
});

test('webhook usa máquina de estados y valida importe/moneda antes de aprobar', () => {
  const webhook = read('api/webhook-mercadopago.js');
  assert.match(webhook, /orderStatusFromPayment\(oldStatus, payment\.status\)/);
  assert.match(webhook, /paymentMatchesOrder\(payment, order\)/);
  assert.match(webhook, /payment\.validation_failed/);
  assert.match(webhook, /total_amount,currency/);
  assert.match(webhook, /payment_status='validation_failed'/);
  assert.match(webhook, /const validationDetail = preservePaymentConflict \? 'multiple_approved_conflict' : 'amount_or_currency_mismatch'/);
  assert.match(webhook, /payment_status_detail=\$\{validationDetail\}/);
  assert.match(webhook, /provider_status: payment\.status/);
  assert.match(webhook, /releaseReservedStockIfUnshipped/);
});

test('checkout legado está cerrado y la home nunca lo invoca', () => {
  const legacy = read('api/crear-preferencia.js');
  const home = read('index.html');
  assert.match(legacy, /status\(410\)/);
  assert.match(legacy, /LEGACY_CHECKOUT_DISABLED/);
  assert.doesNotMatch(home, /fetch\('\/api\/crear-preferencia'/);
  assert.match(home, /window\.location\.href='\/checkout\.html\?cart=1'/);
});

test('admin backend y UI comparten reglas respaldadas por Mercado Pago', () => {
  const adminApi = read('api/admin.js');
  const adminUi = read('admin.html');
  assert.match(adminApi, /adminStatusError/);
  assert.match(adminApi, /transitionError/);
  assert.match(adminUi, /function orderStatusOptions\(o\)/);
  assert.match(adminUi, /orderStatusOptions\(o\)\.map/);
});

test('generación de envío revalida el pago y protege carreras con Enviopack', () => {
  const adminApi = read('api/admin.js');
  assert.match(adminApi, /payment_status='approved'[\s\S]*COALESCE\(payment_status_detail,''\) NOT IN \('multiple_approved_conflict','partially_refunded'\)[\s\S]*status NOT IN \('cancelled','refunded'\) AND enviopack_shipment_id IS NULL/);
  assert.match(adminApi, /firstPaymentGuard/);
  assert.match(adminApi, /secondPaymentGuard/);
  assert.match(adminApi, /PAYMENT_CHANGED_DURING_SHIPMENT/);
  assert.match(adminApi, /orderStatusFromShipping\(currentOrder, 'processing'\)/);
  assert.match(adminApi, /shippingStatusFromProvider\(currentOrder\.shipping_status, 'preparing'\)/);
  assert.match(adminApi, /enviopack\.generation_aborted/);
  assert.match(adminApi, /releaseReservedStockIfUnshipped/);
});

test('envío ya creado nunca queda marcado como reintentable por una falla posterior', () => {
  const adminApi = read('api/admin.js');
  assert.match(adminApi, /providerShipment = shipment/);
  assert.match(adminApi, /enviopack_shipment_id=COALESCE\(enviopack_shipment_id,\$\{recoveredShipmentId\}\)/);
  assert.match(adminApi, /shipping_generation_status='created'/);
  assert.match(adminApi, /SHIPMENT_CREATED_SYNC_FAILED/);
  assert.match(adminApi, /No vuelvas a generarlo/);
});

test('sync de Enviopack no pisa estados financieros, logísticos ni envía avisos con pago no aprobado', () => {
  const adminApi = read('api/admin.js');
  const envios = read('api/envios.js');
  assert.match(adminApi, /orderStatusFromShipping\(order, state\.order\)/);
  assert.match(adminApi, /shippingStatusFromProvider\(order\.shipping_status, state\.shipping\)/);
  assert.match(adminApi, /order\.payment_status === 'approved'/);
  assert.match(envios, /SELECT id,tracking_number,status,payment_status,shipping_status FROM orders/);
  assert.match(envios, /orderStatusFromShipping\(orders\[0\], state\.order\)/);
  assert.match(envios, /shippingStatusFromProvider\(orders\[0\]\.shipping_status, state\.shipping\)/);
  assert.match(envios, /orders\[0\]\.payment_status === 'approved'/);
});

test('seguimiento público usa estado respaldado por el pago y logs sanitizados', () => {
  const notifications = read('lib/notifications.js');
  const tracking = read('api/estado-pedido.js');
  assert.match(notifications, /const SITE_URL = 'https:\/\/mititoys\.com';/);
  assert.doesNotMatch(notifications, /otaku-collectibles\.vercel\.app/);
  assert.match(tracking, /publicOrderStatus/);
  assert.match(tracking, /order\.status = publicOrderStatus\(order\)/);
  assert.match(tracking, /payment\.validation_failed/);
  assert.match(tracking, /checkout\.expired/);
  assert.doesNotMatch(tracking, /console\.error\('estado-pedido error:', error\)/);
});
