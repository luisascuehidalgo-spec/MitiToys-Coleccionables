const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('la base impide asociar un payment_id a más de un pedido', () => {
  const migration = read('database/migrations/20260907_payment_id_uniqueness.sql');
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_id_unique/);
  assert.match(migration, /ON public\.orders \(payment_id\)/);
  assert.match(migration, /WHERE payment_id IS NOT NULL/);
});

test('webhook resuelve el pedido por external_reference único y persiste payment_id', () => {
  const webhook = read('api/webhook-mercadopago.js');
  assert.match(webhook, /WHERE external_reference=\$\{payment\.external_reference\} LIMIT 1/);
  assert.match(webhook, /payment_id=\$\{paymentId\}/);
});

test('webhook detecta ownership conflict antes de modificar el pedido', () => {
  const webhook = read('api/webhook-mercadopago.js');
  const ownershipCheck = webhook.indexOf('WHERE payment_id=${paymentId} AND id<>${order.id}');
  const firstPaymentUpdate = webhook.indexOf('payment_id=${paymentId}');
  assert.ok(ownershipCheck >= 0, 'falta comprobar si el payment_id pertenece a otro pedido');
  assert.ok(firstPaymentUpdate > ownershipCheck, 'la comprobación de ownership debe ocurrir antes de persistir payment_id');
  assert.match(webhook, /payment\.ownership_conflict/);
  assert.match(webhook, /ownership_conflict: true/);
});

test('una carrera contra el índice UNIQUE se convierte en conflicto controlado, no en reintento 500', () => {
  const webhook = read('api/webhook-mercadopago.js');
  assert.match(webhook, /error\?\.code === '23505'/);
  assert.match(webhook, /orders_payment_id_unique\|payment_id/);
  assert.match(webhook, /return res\.status\(200\)\.json\(\{ received: true, ownership_conflict: true \}\)/);
  assert.doesNotMatch(webhook, /console\.error\([^\n]*error\.message/);
});
