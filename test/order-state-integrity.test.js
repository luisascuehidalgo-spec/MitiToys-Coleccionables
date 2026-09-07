const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateAdminStatusTransition,
  publicOrderStatus
} = require('../lib/order-state');

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
