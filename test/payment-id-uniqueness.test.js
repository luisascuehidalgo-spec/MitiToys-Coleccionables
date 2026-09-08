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
  assert.match(webhook, /payment_id=\$\{String\(payment\.id\)\}/);
});
