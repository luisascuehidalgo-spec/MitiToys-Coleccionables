const test = require('node:test');
const assert = require('node:assert/strict');

const { emailContent, senderEmail, validEmail } = require('../lib/notifications');

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
  for (const type of ['payment_approved', 'order_processing', 'shipment_created', 'order_cancelled', 'order_refunded']) {
    const content = emailContent(type, context);
    assert.ok(content?.subject, `Falta asunto para ${type}`);
    assert.match(content.html, /MT-1001/);
    assert.match(content.html, /Luffy Gear 5/);
  }
});
