const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  allocateOrderId,
  expectedItemsJson,
  cleanupCheckoutLocal
} = require('../lib/checkout-persistence');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('allocateOrderId reserva el id desde la secuencia antes de insertar el pedido', async () => {
  let calls = 0;
  const sql = async (strings) => {
    calls += 1;
    const text = strings.join('?');
    assert.match(text, /nextval\(pg_get_serial_sequence\('orders','id'\)\)/);
    return [{ id: '321' }];
  };
  assert.equal(await allocateOrderId(sql), 321);
  assert.equal(calls, 1);
});

test('expectedItemsJson conserva producto, cantidad, importes y flag de stock', () => {
  const parsed = JSON.parse(expectedItemsJson([
    { id: 'A', qty: 2, price: 1250, stockManaged: true },
    { id: 'B', qty: 1, price: 3000, stockManaged: false }
  ]));
  assert.deepEqual(parsed, [
    { product_id: 'A', quantity: 2, unit_price: 1250, total_amount: 2500, stock_managed: true },
    { product_id: 'B', quantity: 1, unit_price: 3000, total_amount: 3000, stock_managed: false }
  ]);
});

test('persistCheckoutLocal hace indivisibles order, quote, items, reservas y guard final', () => {
  const source = read('lib/checkout-persistence.js');
  const start = source.indexOf('async function persistCheckoutLocal');
  const end = source.indexOf('async function cleanupCheckoutLocal', start);
  const block = source.slice(start, end);

  assert.match(block, /sql\.transaction\(\(txn\) =>/);
  assert.match(block, /isolationMode: 'Serializable'/);
  assert.match(block, /INSERT INTO orders/);
  assert.match(block, /UPDATE shipping_quotes SET used_at=NOW\(\),order_id=\$\{orderId\}/);
  assert.match(block, /INSERT INTO order_items/);
  assert.match(block, /reserveStockQuery\(txn/);
  assert.match(block, /checkoutIntegrityGuard\(txn\)/);
  assert.match(block, /externalReference = `MITITOYS-ORDER-\$\{orderId\}`/);
  assert.doesNotMatch(block, /MITITOYS-PENDING/);
});

test('guard final valida cantidad de items, subtotal, quote y reserva por producto gestionado', () => {
  const source = read('lib/checkout-persistence.js');
  const start = source.indexOf('function checkoutIntegrityGuard');
  const end = source.indexOf('async function persistCheckoutLocal', start);
  const block = source.slice(start, end);

  assert.match(block, /COUNT\(\*\) FROM order_items/);
  assert.match(block, /jsonb_array_length\(expected_items\)/);
  assert.match(block, /SUM\(oi\.total_amount\)/);
  assert.match(block, /q\.order_id=o\.id AND q\.used_at IS NOT NULL/);
  assert.match(block, /movement_type='reserve'/);
  assert.match(block, /m\.quantity=-\(expected->>'quantity'\)::integer/);
  assert.match(block, /CHECKOUT_LOCAL_INTEGRITY_FAILED/);
});

test('cleanup posterior al fallo de Mercado Pago es una sola sentencia con claim financiero seguro', async () => {
  let calls = 0;
  const sql = async (strings) => {
    calls += 1;
    const text = strings.join('?');
    assert.match(text, /WITH claimed_order AS/);
    assert.match(text, /status='pending'/);
    assert.match(text, /payment_id IS NULL/);
    assert.match(text, /COALESCE\(payment_status,'pending'\)='pending'/);
    assert.match(text, /preference_id IS NULL/);
    assert.match(text, /payment_url IS NULL/);
    assert.match(text, /INSERT INTO inventory_movements/);
    assert.match(text, /movement_type,quantity,reason/);
    assert.match(text, /ON CONFLICT \(order_id,product_id,movement_type\)/);
    assert.match(text, /UPDATE products p/);
    assert.match(text, /UPDATE shipping_quotes/);
    assert.match(text, /checkout\.local_cleanup/);
    return [{ cleaned: true, released_units: 3, released_quotes: 1, event_recorded: true }];
  };

  const result = await cleanupCheckoutLocal(sql, { orderId: 44 });
  assert.deepEqual(result, { cleaned: true, releasedUnits: 3, releasedQuotes: 1, eventRecorded: true });
  assert.equal(calls, 1);
});

test('endpoint delega persistencia y cleanup; no vuelve a escribir esas piezas por separado', () => {
  const api = read('api/crear-preferencia-carrito.js');
  assert.match(api, /allocateOrderId/);
  assert.match(api, /persistCheckoutLocal/);
  assert.match(api, /cleanupCheckoutLocal/);
  assert.doesNotMatch(api, /MITITOYS-PENDING/);
  assert.doesNotMatch(api, /INSERT INTO order_items/);
  assert.doesNotMatch(api, /reserveStock\(sql/);
  assert.doesNotMatch(api, /UPDATE orders SET status='cancelled'/);
  assert.doesNotMatch(api, /UPDATE shipping_quotes SET used_at=NULL,order_id=NULL/);
});
