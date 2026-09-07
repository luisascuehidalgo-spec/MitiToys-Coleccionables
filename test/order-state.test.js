const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  orderStatusFromPayment,
  orderStatusFromShipping,
  shippingStatusFromProvider,
  adminStatusError,
  adminStatusOptions
} = require('../lib/order-state');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('webhooks aprobados no retroceden preparación, envío o entrega', () => {
  assert.equal(orderStatusFromPayment('approved', 'approved'), 'approved');
  assert.equal(orderStatusFromPayment('processing', 'approved'), 'processing');
  assert.equal(orderStatusFromPayment('shipped', 'approved'), 'shipped');
  assert.equal(orderStatusFromPayment('delivered', 'approved'), 'delivered');
});

test('notificaciones pendientes no degradan un pedido que ya avanzó', () => {
  assert.equal(orderStatusFromPayment('approved', 'pending'), 'approved');
  assert.equal(orderStatusFromPayment('processing', 'in_process'), 'processing');
  assert.equal(orderStatusFromPayment('shipped', 'pending'), 'shipped');
});

test('estados terminales del proveedor prevalecen sin resucitar un reembolso', () => {
  assert.equal(orderStatusFromPayment('processing', 'rejected'), 'cancelled');
  assert.equal(orderStatusFromPayment('shipped', 'refunded'), 'refunded');
  assert.equal(orderStatusFromPayment('refunded', 'rejected'), 'refunded');
  assert.equal(orderStatusFromPayment('refunded', 'approved'), 'refunded');
});

test('Enviopack solo avanza fulfillment y nunca lo retrocede', () => {
  assert.equal(orderStatusFromShipping('approved', 'approved', 'processing'), 'processing');
  assert.equal(orderStatusFromShipping('processing', 'approved', 'shipped'), 'shipped');
  assert.equal(orderStatusFromShipping('shipped', 'approved', 'delivered'), 'delivered');
  assert.equal(orderStatusFromShipping('shipped', 'approved', 'processing'), 'shipped');
  assert.equal(orderStatusFromShipping('delivered', 'approved', 'processing'), 'delivered');
});

test('Enviopack no avanza pedidos sin pago aprobado ni revive terminales', () => {
  assert.equal(orderStatusFromShipping('pending', 'pending', 'shipped'), 'pending');
  assert.equal(orderStatusFromShipping('pending', 'validation_failed', 'delivered'), 'pending');
  assert.equal(orderStatusFromShipping('cancelled', 'approved', 'delivered'), 'cancelled');
  assert.equal(orderStatusFromShipping('refunded', 'approved', 'delivered'), 'refunded');
});

test('estado de transporte conserva hitos fuertes ante respuestas transitorias', () => {
  assert.equal(shippingStatusFromProvider('delivered', 'preparing'), 'delivered');
  assert.equal(shippingStatusFromProvider('in_transit', 'preparing'), 'in_transit');
  assert.equal(shippingStatusFromProvider('exception', 'preparing'), 'exception');
  assert.equal(shippingStatusFromProvider('exception', 'in_transit'), 'in_transit');
  assert.equal(shippingStatusFromProvider('preparing', 'delivered'), 'delivered');
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

test('admin respeta cancelación y reembolso confirmados por el proveedor', () => {
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
  assert.deepEqual(
    adminStatusOptions({ status: 'pending', payment_status: 'validation_failed', payment_id: 'p2' }).sort(),
    ['pending']
  );
});

test('webhook usa máquina de estados y valida importe/moneda antes de aprobar', () => {
  const webhook = read('api/webhook-mercadopago.js');
  assert.match(webhook, /orderStatusFromPayment\(oldStatus, payment\.status\)/);
  assert.match(webhook, /paymentMatchesOrder\(payment, order\)/);
  assert.match(webhook, /payment\.validation_failed/);
  assert.match(webhook, /total_amount,currency/);
  assert.match(webhook, /payment_status='validation_failed'/);
  assert.match(webhook, /payment_status_detail='amount_or_currency_mismatch'/);
});

test('Enviopack aplica guard monotónico en webhook, sync manual y creación', () => {
  const envios = read('api/envios.js');
  const admin = read('api/admin.js');
  assert.match(envios, /orderStatusFromShipping\(orders\[0\]\.status, orders\[0\]\.payment_status, state\.order\)/);
  assert.match(envios, /shippingStatusFromProvider\(orders\[0\]\.shipping_status, state\.shipping\)/);
  assert.match(admin, /orderStatusFromShipping\(order\.status, order\.payment_status, 'processing'\)/);
  assert.match(admin, /orderStatusFromShipping\(order\.status, order\.payment_status, state\.order\)/);
  assert.match(admin, /shippingStatusFromProvider\(order\.shipping_status, state\.shipping\)/);
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

test('emails y seguimiento usan dominio oficial y logs sanitizados', () => {
  const notifications = read('lib/notifications.js');
  const tracking = read('api/estado-pedido.js');
  assert.match(notifications, /const SITE_URL = 'https:\/\/mititoys\.com';/);
  assert.doesNotMatch(notifications, /otaku-collectibles\.vercel\.app/);
  assert.match(tracking, /payment\.validation_failed/);
  assert.match(tracking, /checkout\.expired/);
  assert.doesNotMatch(tracking, /console\.error\('estado-pedido error:', error\)/);
});
