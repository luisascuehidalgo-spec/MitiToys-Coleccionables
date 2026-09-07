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

test('una cotización solo puede ser reclamada una vez antes de reservar stock', () => {
  const api = read('api/crear-preferencia-carrito.js');
  const claim = "UPDATE shipping_quotes SET used_at=NOW(),order_id=${orderId} WHERE id=${shippingQuoteId} AND used_at IS NULL AND expires_at>NOW() RETURNING id";
  const orderItemInsert = 'INSERT INTO order_items';
  const stockReserve = 'reserveStock(sql, { productId: item.id, orderId, quantity: item.qty })';

  const claimIndex = api.indexOf(claim);
  const orderItemIndex = api.indexOf(orderItemInsert);
  const stockReserveIndex = api.indexOf(stockReserve);

  assert.ok(claimIndex > 0, 'Falta el claim atómico de la cotización.');
  assert.ok(orderItemIndex > claimIndex, 'order_items no debe escribirse antes de reclamar la cotización.');
  assert.ok(stockReserveIndex > orderItemIndex, 'El stock no debe reservarse antes de reclamar la cotización y crear order_items.');
  assert.match(api, /if \(!claimed\.length\) throw Object\.assign\(new Error\('La cotización ya fue utilizada o venció\.'/);
});

test('un checkout que pierde la carrera no libera una cotización perteneciente a otro pedido', () => {
  const api = read('api/crear-preferencia-carrito.js');
  assert.match(
    api,
    /UPDATE shipping_quotes SET used_at=NULL,order_id=NULL WHERE id=\$\{shippingQuoteId\} AND order_id=\$\{orderId\}/
  );
});
