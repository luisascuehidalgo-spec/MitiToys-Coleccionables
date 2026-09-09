const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { reserveStockQuery, reserveStock } = require('../lib/inventory');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('descuento de stock y movimiento reserve ocurren en una sola sentencia SQL', async () => {
  let calls = 0;
  const sql = (strings, ...values) => {
    calls += 1;
    const text = strings.join('?');
    assert.match(text, /WITH updated_product AS/);
    assert.match(text, /UPDATE products/);
    assert.match(text, /stock_quantity=stock_quantity-/);
    assert.match(text, /inserted_reserve AS/);
    assert.match(text, /INSERT INTO inventory_movements/);
    assert.match(text, /movement_type,quantity,reason/);
    assert.match(text, /FROM updated_product/);
    assert.doesNotMatch(text, /ON CONFLICT/);
    return Promise.resolve([{ product_id: '1705', quantity: -2 }]);
  };

  assert.deepEqual(
    await reserveStock(sql, { productId: '1705', orderId: 77, quantity: 2 }),
    [{ product_id: '1705', quantity: 2 }]
  );
  assert.equal(calls, 1);
});

test('reserveStockQuery devuelve la sentencia sin ejecutarla para incluirla en una transacción', async () => {
  let executed = false;
  const query = Promise.resolve([{ product_id: '1705', quantity: -2 }]);
  const sql = (strings) => {
    const text = strings.join('?');
    assert.match(text, /WITH updated_product AS/);
    return query;
  };
  const built = reserveStockQuery(sql, { productId: '1705', orderId: 77, quantity: 2 });
  assert.equal(built, query);
  assert.equal(executed, false);
});

test('si no hay stock suficiente no se registra reserva', async () => {
  const sql = () => Promise.resolve([]);
  assert.deepEqual(
    await reserveStock(sql, { productId: '1705', orderId: 77, quantity: 99 }),
    []
  );
});

test('checkout usa persistencia transaccional y no separa descuento de movimiento de inventario', () => {
  const checkout = read('api/crear-preferencia-carrito.js');
  const persistence = read('lib/checkout-persistence.js');
  assert.match(checkout, /persistCheckoutLocal/);
  assert.match(persistence, /reserveStockQuery/);
  assert.match(persistence, /sql\.transaction/);
  assert.doesNotMatch(checkout, /reserveStock\(sql/);
  assert.doesNotMatch(checkout, /UPDATE products SET stock_quantity=stock_quantity-\$\{item\.qty\}/);
  assert.doesNotMatch(checkout, /INSERT INTO inventory_movements\(product_id,order_id,movement_type,quantity,reason\) VALUES\(\$\{item\.id\},\$\{orderId\},'reserve'/);
});

test('la migración impide dos reservas del mismo producto para el mismo pedido', () => {
  const migration = read('database/migrations/20260907_inventory_reserve_idempotency.sql');
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_one_reserve_per_order_product/);
  assert.match(migration, /order_id, product_id, movement_type/);
  assert.match(migration, /order_id IS NOT NULL/);
  assert.match(migration, /movement_type = 'reserve'/);
});
