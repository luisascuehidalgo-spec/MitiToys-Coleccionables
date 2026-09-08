const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'database', 'migrations', '20260908_external_order_identities.sql'),
  'utf8'
);

test('una preferencia de Mercado Pago solo puede pertenecer a un pedido', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS orders_preference_id_unique/);
  assert.match(migration, /ON public\.orders \(preference_id\)/);
  assert.match(migration, /WHERE preference_id IS NOT NULL/);
});

test('un envío de Enviopack solo puede pertenecer a un pedido', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS orders_enviopack_shipment_id_unique/);
  assert.match(migration, /ON public\.orders \(enviopack_shipment_id\)/);
  assert.match(migration, /WHERE enviopack_shipment_id IS NOT NULL/);
});
