const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('checkout bloquea ambos botones mientras crea el pedido', () => {
  const checkout = read('checkout.html');
  const request = "fetch('/api/crear-preferencia-carrito'";
  const requestIndex = checkout.indexOf(request);
  assert.ok(requestIndex > 0, 'No se encontró la llamada al backend de checkout.');

  const beforeRequest = checkout.slice(0, requestIndex);
  assert.match(beforeRequest, /button\.disabled = true;/);
  assert.match(beforeRequest, /mobileButton\.disabled = true;/);
});

test('cotización, items y reservas se persisten en ese orden dentro de una transacción', () => {
  const persistence = read('lib/checkout-persistence.js');
  const claimIndex = persistence.indexOf('UPDATE shipping_quotes SET used_at=NOW(),order_id=${orderId}');
  const orderItemIndex = persistence.indexOf('INSERT INTO order_items');
  const stockReserveIndex = persistence.indexOf('reserveStockQuery(txn');
  const guardIndex = persistence.indexOf('queries.push(checkoutIntegrityGuard(txn))');

  assert.match(persistence, /sql\.transaction\(\(txn\) =>/);
  assert.match(persistence, /isolationMode: 'Serializable'/);
  assert.ok(claimIndex > 0, 'Falta el claim atómico de la cotización.');
  assert.ok(orderItemIndex > claimIndex, 'order_items no debe escribirse antes de reclamar la cotización.');
  assert.ok(stockReserveIndex > orderItemIndex, 'El stock no debe reservarse antes de reclamar la cotización y crear order_items.');
  assert.ok(guardIndex > stockReserveIndex, 'La validación final debe ejecutarse después de todas las reservas.');
  assert.match(persistence, /WHERE id=\$\{shippingQuoteId\} AND used_at IS NULL AND expires_at>NOW\(\)/);
});

test('un checkout que pierde la carrera no libera una cotización perteneciente a otro pedido', () => {
  const persistence = read('lib/checkout-persistence.js');
  const cleanupStart = persistence.indexOf('async function cleanupCheckoutLocal');
  const cleanup = persistence.slice(cleanupStart);

  assert.match(cleanup, /WITH claimed_order AS/);
  assert.match(cleanup, /WHERE id=\$\{orderId\}/);
  assert.match(cleanup, /payment_id IS NULL/);
  assert.match(cleanup, /COALESCE\(payment_status,'pending'\)='pending'/);
  assert.match(cleanup, /preference_id IS NULL/);
  assert.match(cleanup, /payment_url IS NULL/);
  assert.match(cleanup, /UPDATE shipping_quotes[\s\S]*WHERE order_id IN \(SELECT id FROM claimed_order\)/);
});
