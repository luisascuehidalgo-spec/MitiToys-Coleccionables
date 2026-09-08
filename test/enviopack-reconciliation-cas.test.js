const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { persistCreatedShipment } = require('../lib/shipping-sync');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('reconciliación no degrada tracking más avanzado que llegó durante la carrera', async () => {
  let reads = 0;
  let updates = 0;
  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('SELECT id,status,payment_status,payment_status_detail,shipping_status,tracking_number')) {
      reads += 1;
      if (reads === 1) {
        return [{
          id: 88,
          status: 'processing',
          payment_status: 'approved',
          payment_status_detail: null,
          shipping_status: 'preparing',
          tracking_number: null,
          enviopack_shipment_id: null,
          shipping_generation_status: 'uncertain'
        }];
      }
      return [{
        id: 88,
        status: 'delivered',
        payment_status: 'approved',
        payment_status_detail: null,
        shipping_status: 'delivered',
        tracking_number: 'TRACK-88',
        enviopack_shipment_id: null,
        shipping_generation_status: 'uncertain'
      }];
    }
    if (text.includes('UPDATE orders SET')) {
      updates += 1;
      if (updates === 1) return [];
      assert.match(text, /shipping_status IS NOT DISTINCT FROM/);
      assert.match(text, /shipping_generation_status IS NOT DISTINCT FROM/);
      return [{
        id: 88,
        status: 'delivered',
        payment_status: 'approved',
        payment_status_detail: null,
        shipping_status: 'delivered',
        tracking_number: 'TRACK-88',
        enviopack_shipment_id: 'SHIP-88',
        shipping_generation_status: 'created'
      }];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const result = await persistCreatedShipment(sql, {
    orderId: 88,
    shipmentId: 'SHIP-88',
    providerState: 'P',
    trackingNumber: 'TRACK-88',
    labelReady: true,
    proposedOrderStatus: 'processing',
    proposedShippingStatus: 'preparing',
    attempts: 3
  });

  assert.equal(result.ok, true);
  assert.equal(result.retries, 1);
  assert.equal(result.order.status, 'delivered');
  assert.equal(result.order.shipping_status, 'delivered');
  assert.equal(result.order.enviopack_shipment_id, 'SHIP-88');
});

test('reconciliación detecta que el mismo shipment ya fue asociado por otra carrera', async () => {
  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('SELECT id,status,payment_status,payment_status_detail,shipping_status,tracking_number')) {
      return [{
        id: 88,
        status: 'processing',
        payment_status: 'approved',
        payment_status_detail: null,
        shipping_status: 'preparing',
        tracking_number: 'TRACK-88',
        enviopack_shipment_id: 'SHIP-88',
        shipping_generation_status: 'created'
      }];
    }
    if (text.includes('UPDATE orders SET')) {
      return [{
        id: 88,
        status: 'processing',
        payment_status: 'approved',
        payment_status_detail: null,
        shipping_status: 'preparing',
        tracking_number: 'TRACK-88',
        enviopack_shipment_id: 'SHIP-88',
        shipping_generation_status: 'created'
      }];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const result = await persistCreatedShipment(sql, {
    orderId: 88,
    shipmentId: 'SHIP-88',
    proposedOrderStatus: 'processing',
    proposedShippingStatus: 'preparing'
  });

  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
});

test('reconcileShipmentCreation usa CAS compartido y no conserva su UPDATE directo inseguro', () => {
  const admin = read('api/admin.js');
  const start = admin.indexOf('async function reconcileShipmentCreation');
  const end = admin.indexOf('async function syncShipment', start);
  const block = admin.slice(start, end);

  assert.match(block, /persistCreatedShipment\(sql/);
  assert.match(block, /proposedOrderStatus:\s*state\.order/);
  assert.match(block, /proposedShippingStatus:\s*state\.shipping/);
  assert.match(block, /attempts:\s*3/);
  assert.match(block, /SHIPMENT_RECONCILIATION_RACE/);
  assert.match(block, /SHIPMENT_RECONCILIATION_CONFLICT/);
  assert.doesNotMatch(block, /UPDATE orders SET enviopack_shipment_id=\$\{shipmentId\}/);
});

test('resultado vacío de Enviopack no puede degradar un shipment asociado concurrentemente', () => {
  const admin = read('api/admin.js');
  const start = admin.indexOf('async function reconcileShipmentCreation');
  const end = admin.indexOf("if (shipments.length > 1)", start);
  const emptyBlock = admin.slice(start, end);

  assert.match(emptyBlock, /enviopack_shipment_id IS NULL/);
  assert.match(emptyBlock, /shipping_generation_status IN \('not_created','failed','processing','uncertain'\)/);
  assert.match(emptyBlock, /SELECT enviopack_shipment_id,shipping_generation_status/);
  assert.match(emptyBlock, /current\?\.enviopack_shipment_id/);
});

test('evento de reconciliación usa el estado realmente persistido y evita duplicarlo si fue reutilizado', () => {
  const admin = read('api/admin.js');
  const start = admin.indexOf('async function reconcileShipmentCreation');
  const end = admin.indexOf('async function syncShipment', start);
  const block = admin.slice(start, end);

  assert.match(block, /if \(!persisted\.reused\)/);
  assert.match(block, /persisted\.before\.status/);
  assert.match(block, /persisted\.order\.status/);
  assert.match(block, /persisted\.order\.payment_status === 'approved'/);
  assert.match(block, /!requiresPaymentReview\(persisted\.order\)/);
});
