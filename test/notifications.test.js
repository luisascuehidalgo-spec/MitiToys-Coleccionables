const test = require('node:test');
const assert = require('node:assert/strict');

const { emailContent, notificationAllowed, senderEmail, validEmail } = require('../lib/notifications');

const context = {
  order: {
    order_number: 'MT-1001',
    customer_name: 'Luis',
    shipping_recipient: 'Luis',
    shipping_carrier: 'Enviopack',
    tracking_number: 'ABC123'
  },
  items: [{ product_id: '3377', product_title: 'Luffy Gear 5', quantity: 1 }],
  reviews: []
};

test('validEmail normaliza direcciones validas y descarta valores incorrectos', () => {
  assert.equal(validEmail(' Pedidos@MitiToys.com '), 'pedidos@mititoys.com');
  assert.equal(validEmail('sin-arroba'), '');
});

test('senderEmail extrae el correo del remitente con nombre visible', () => {
  const previous = process.env.MITITOYS_FROM_EMAIL;
  process.env.MITITOYS_FROM_EMAIL = 'MitiToys <pedidos@mititoys.com>';
  assert.equal(senderEmail(), 'pedidos@mititoys.com');
  if (previous === undefined) delete process.env.MITITOYS_FROM_EMAIL;
  else process.env.MITITOYS_FROM_EMAIL = previous;
});

test('existen plantillas para cada cambio esencial del pedido', () => {
  for (const type of ['payment_approved', 'order_processing', 'shipment_created', 'order_delivered', 'order_cancelled', 'order_refunded', 'review_invite']) {
    const content = emailContent(type, context);
    assert.ok(content?.subject, `Falta asunto para ${type}`);
    assert.match(content.html, /MT-1001/);
    assert.match(content.html, /Luffy Gear 5/);
  }
});

test('notificaciones transaccionales se validan contra el estado financiero y operativo actual', () => {
  const approved = {
    status: 'approved',
    payment_status: 'approved',
    payment_status_detail: null,
    tracking_number: null,
    enviopack_shipment_id: null
  };
  assert.equal(notificationAllowed('payment_approved', approved), true);
  assert.equal(notificationAllowed('order_processing', { ...approved, status: 'processing' }), true);
  assert.equal(notificationAllowed('shipment_created', {
    ...approved,
    status: 'processing',
    enviopack_shipment_id: 'SHIP-1'
  }), true);
  assert.equal(notificationAllowed('order_delivered', { ...approved, status: 'delivered' }), true);
  assert.equal(notificationAllowed('review_invite', { ...approved, status: 'delivered' }), true);
  assert.equal(notificationAllowed('order_cancelled', { status: 'cancelled', payment_status: 'rejected' }), true);
  assert.equal(notificationAllowed('order_refunded', { status: 'refunded', payment_status: 'refunded' }), true);
});

test('pagos en revisión, reembolsos y estados obsoletos bloquean emails incompatibles', () => {
  assert.equal(notificationAllowed('review_invite', {
    status: 'delivered',
    payment_status: 'refunded',
    payment_status_detail: null
  }), false);
  assert.equal(notificationAllowed('order_delivered', {
    status: 'delivered',
    payment_status: 'approved',
    payment_status_detail: 'partially_refunded'
  }), false);
  assert.equal(notificationAllowed('payment_approved', {
    status: 'cancelled',
    payment_status: 'approved',
    payment_status_detail: 'late_approval_conflict'
  }), false);
  assert.equal(notificationAllowed('shipment_created', {
    status: 'delivered',
    payment_status: 'approved',
    payment_status_detail: null,
    enviopack_shipment_id: 'SHIP-1'
  }), false);
  assert.equal(notificationAllowed('abandoned_checkout', {
    status: 'pending',
    payment_status: 'approved',
    payment_url: 'https://example.test/pay'
  }), false);
});
