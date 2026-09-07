const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { releaseReservedStockIfUnshipped } = require('../lib/inventory');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function skippedSql(order) {
  return async (strings) => {
    const text = strings.join('?');
    if (text.includes('SELECT shipping_status,shipping_generation_status,enviopack_shipment_id')) return [order];
    throw new Error('No debía ejecutar SQL adicional: ' + text);
  };
}

test('no repone stock cuando la generación o el envío ya comenzaron', async () => {
  const cases = [
    { shipping_status: 'not_shipped', shipping_generation_status: 'processing', enviopack_shipment_id: null },
    { shipping_status: 'not_shipped', shipping_generation_status: 'created', enviopack_shipment_id: null },
    { shipping_status: 'in_transit', shipping_generation_status: 'failed', enviopack_shipment_id: null },
    { shipping_status: 'delivered', shipping_generation_status: 'failed', enviopack_shipment_id: null },
    { shipping_status: 'preparing', shipping_generation_status: 'failed', enviopack_shipment_id: 'env-123' }
  ];

  for (const order of cases) {
    assert.deepEqual(
      await releaseReservedStockIfUnshipped(skippedSql(order), 77, 'test'),
      { released: [], skipped: 'shipment_started' }
    );
  }
});

test('si la generación falló antes de crear envío, una orden terminal puede recuperar su reserva', async () => {
  const calls = [];
  const sql = async (strings) => {
    const text = strings.join('?');
    calls.push(text);
    if (text.includes('SELECT shipping_status,shipping_generation_status,enviopack_shipment_id')) {
      return [{ shipping_status: 'not_shipped', shipping_generation_status: 'failed', enviopack_shipment_id: null }];
    }
    if (text.startsWith('SELECT product_id,quantity FROM order_items')) {
      return [{ product_id: '1705', quantity: 2 }];
    }
    if (text.includes('WITH inserted_release')) {
      return [{ id: '1705', quantity: 2 }];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  assert.deepEqual(
    await releaseReservedStockIfUnshipped(sql, 77, 'test'),
    { released: [{ product_id: '1705', quantity: 2 }], skipped: null }
  );
  assert.ok(calls.some(text => text.includes('WITH inserted_release')));
});

test('webhook de pago usa liberación protegida por estado de despacho', () => {
  const webhook = read('api/webhook-mercadopago.js');
  assert.match(webhook, /releaseReservedStockIfUnshipped/);
  assert.doesNotMatch(webhook, /const \{ releaseReservedStock \} = require\('\.\.\/lib\/inventory'\)/);
  assert.match(webhook, /stock_release: stockRelease/);
});

test('creación de envío reclama el pedido solo si el pago sigue aprobado', () => {
  const admin = read('api/admin.js');
  assert.match(admin, /payment_status='approved'/);
  assert.match(admin, /status NOT IN \('cancelled','refunded'\)/);
  assert.match(admin, /const paymentGuard = await sql`SELECT status,payment_status FROM orders/);
  assert.match(admin, /Mercado Pago cambió el estado del pago antes de confirmar el envío/);
});

test('createdShipment vive fuera del try y permite compensar errores posteriores', () => {
  const admin = read('api/admin.js');
  assert.match(admin, /let createdShipment = null;\n  try \{/);
  assert.doesNotMatch(admin, /\n    let createdShipment = null;\n    const shipment/);
  assert.match(admin, /if \(createdShipment\?\.id\)/);
  assert.match(admin, /enviopack_shipment_id=\$\{String\(createdShipment\.id\)\}/);
  assert.match(admin, /shipping_generation_status='created'/);
});

test('si Enviopack no creó envío y el pago terminó, el catch permite liberar la reserva', () => {
  const admin = read('api/admin.js');
  assert.match(admin, /shipping_generation_status='failed'/);
  assert.match(admin, /\['cancelled','refunded'\]\.includes/);
  assert.match(admin, /Liberación tras fallo de generación de envío con pago terminal/);
});

test('emails de envío se emiten solo con pago aún aprobado', () => {
  const admin = read('api/admin.js');
  const envios = read('api/envios.js');
  assert.match(admin, /currentOrder\.payment_status === 'approved'/);
  assert.match(admin, /order\.payment_status === 'approved'/);
  assert.match(envios, /orders\[0\]\.payment_status === 'approved'/);
});

test('archivos críticos mantienen sintaxis JavaScript válida', () => {
  for (const file of ['api/admin.js', 'api/envios.js', 'api/webhook-mercadopago.js', 'lib/inventory.js', 'lib/order-state.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  }
});

test('no quedan scripts ni workflows temporales de esta corrección', () => {
  assert.equal(fs.existsSync(path.join(root, 'scripts/apply_shipment_race_guard_temp.py')), false);
  assert.equal(fs.existsSync(path.join(root, 'scripts/apply_final_fulfillment_guards_temp.py')), false);
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/apply-shipment-race-guard-temp.yml')), false);
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/apply-final-fulfillment-guards-temp.yml')), false);
});
