const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { persistShippingObservation } = require('../lib/shipping-sync');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('un refund concurrente gana sobre un sync logístico obsoleto', async () => {
  let reads = 0;
  let updates = 0;
  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('SELECT id,status,payment_status,payment_status_detail,shipping_status,tracking_number')) {
      reads += 1;
      if (reads === 1) {
        return [{ id: 77, status: 'shipped', payment_status: 'approved', payment_status_detail: null, shipping_status: 'in_transit', tracking_number: 'OLD' }];
      }
      return [{ id: 77, status: 'refunded', payment_status: 'refunded', payment_status_detail: 'refunded', shipping_status: 'in_transit', tracking_number: 'OLD' }];
    }
    if (text.includes('UPDATE orders SET')) {
      updates += 1;
      if (updates === 1) return [];
      assert.match(text, /status IS NOT DISTINCT FROM/);
      assert.match(text, /payment_status IS NOT DISTINCT FROM/);
      assert.match(text, /payment_status_detail IS NOT DISTINCT FROM/);
      assert.match(text, /shipping_status IS NOT DISTINCT FROM/);
      return [{ id: 77, status: 'refunded', payment_status: 'refunded', payment_status_detail: 'refunded', shipping_status: 'delivered', tracking_number: 'NEW' }];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const result = await persistShippingObservation(sql, {
    orderId: 77,
    providerState: 'P',
    trackingNumber: 'NEW',
    labelReady: true,
    proposedOrderStatus: 'delivered',
    proposedShippingStatus: 'delivered'
  });

  assert.equal(result.ok, true);
  assert.equal(result.retries, 1);
  assert.equal(result.order.status, 'refunded');
  assert.equal(result.order.payment_status, 'refunded');
  assert.equal(result.order.shipping_status, 'delivered');
});

test('el guard compara identidad financiera y logística antes de escribir', () => {
  const helper = read('lib/shipping-sync.js');
  assert.match(helper, /AND status IS NOT DISTINCT FROM \$\{snapshot\.status\}/);
  assert.match(helper, /AND payment_status IS NOT DISTINCT FROM \$\{snapshot\.payment_status\}/);
  assert.match(helper, /AND payment_status_detail IS NOT DISTINCT FROM \$\{snapshot\.payment_status_detail\}/);
  assert.match(helper, /AND shipping_status IS NOT DISTINCT FROM \$\{snapshot\.shipping_status\}/);
  assert.match(helper, /orderStatusFromShipping\(snapshot, proposedOrderStatus\)/);
  assert.match(helper, /shippingStatusFromProvider\(snapshot\.shipping_status, proposedShippingStatus\)/);
});

test('webhook de Enviopack persiste mediante CAS y notifica solo desde el estado confirmado', () => {
  const envios = read('api/envios.js');
  const start = envios.indexOf('async function syncProviderShipment');
  const end = envios.indexOf('async function runAutomation', start);
  const block = envios.slice(start, end);
  assert.match(block, /persistShippingObservation\(sql/);
  assert.match(block, /persisted\.order\.payment_status === 'approved'/);
  assert.match(block, /!requiresPaymentReview\(persisted\.order\)/);
  assert.match(block, /persisted\.order\.status === 'delivered'/);
  assert.doesNotMatch(block, /UPDATE orders SET[\s\S]*status=\$\{state\.order\}[\s\S]*WHERE id=\$\{orders\[0\]\.id\}/);
});

test('sync manual de admin usa el mismo CAS y devuelve 409 si no puede reconciliar la carrera', () => {
  const admin = read('api/admin.js');
  const start = admin.indexOf('async function syncShipment');
  const end = admin.indexOf('module.exports = async', start);
  const block = admin.slice(start, end);
  assert.match(block, /persistShippingObservation\(sql/);
  assert.match(block, /code: 'SHIPMENT_SYNC_RACE'/);
  assert.match(block, /persisted\.order\.payment_status === 'approved'/);
  assert.match(block, /!requiresPaymentReview\(persisted\.order\)/);
  assert.match(block, /persisted\.order\.status === 'delivered'/);
  assert.doesNotMatch(block, /UPDATE orders SET[\s\S]*status=\$\{state\.order\}[\s\S]*WHERE id=\$\{id\}/);
});
