const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { persistCreatedShipment } = require('../lib/shipping-sync');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('refund concurrente no se pierde al fijar un shipment recién creado', async () => {
  let reads = 0;
  let updates = 0;
  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('SELECT id,status,payment_status,payment_status_detail,shipping_status,tracking_number')) {
      reads += 1;
      if (reads === 1) {
        return [{
          id: 88,
          status: 'approved',
          payment_status: 'approved',
          payment_status_detail: null,
          shipping_status: 'not_shipped',
          tracking_number: null,
          enviopack_shipment_id: null,
          shipping_generation_status: 'processing'
        }];
      }
      return [{
        id: 88,
        status: 'refunded',
        payment_status: 'refunded',
        payment_status_detail: 'refunded',
        shipping_status: 'not_shipped',
        tracking_number: null,
        enviopack_shipment_id: null,
        shipping_generation_status: 'processing'
      }];
    }
    if (text.includes('UPDATE orders SET')) {
      updates += 1;
      if (updates === 1) return [];
      assert.match(text, /enviopack_shipment_id=COALESCE/);
      assert.match(text, /payment_status IS NOT DISTINCT FROM/);
      assert.match(text, /shipping_generation_status IS NOT DISTINCT FROM/);
      return [{
        id: 88,
        status: 'refunded',
        payment_status: 'refunded',
        payment_status_detail: 'refunded',
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
    providerState: 'P',
    trackingNumber: 'TRACK-88',
    labelReady: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.retries, 1);
  assert.equal(result.order.enviopack_shipment_id, 'SHIP-88');
  assert.equal(result.order.shipping_generation_status, 'created');
  assert.equal(result.order.status, 'refunded');
  assert.equal(result.order.payment_status, 'refunded');
});

test('un shipment local distinto nunca es sobrescrito por una carrera', async () => {
  let updates = 0;
  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('SELECT id,status,payment_status,payment_status_detail,shipping_status,tracking_number')) {
      return [{
        id: 88,
        status: 'processing',
        payment_status: 'approved',
        payment_status_detail: null,
        shipping_status: 'preparing',
        tracking_number: 'OLD',
        enviopack_shipment_id: 'SHIP-OTHER',
        shipping_generation_status: 'created'
      }];
    }
    if (text.includes('UPDATE orders SET')) {
      updates += 1;
      return [];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const result = await persistCreatedShipment(sql, { orderId: 88, shipmentId: 'SHIP-NEW' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'identity_conflict');
  assert.equal(updates, 0);
});

test('persistencia de creación compara estado financiero, logístico e identidad externa', () => {
  const helper = read('lib/shipping-sync.js');
  const start = helper.indexOf('async function persistCreatedShipment');
  const block = helper.slice(start);
  assert.match(block, /enviopack_shipment_id IS NULL OR enviopack_shipment_id=\$\{id\}/);
  assert.match(block, /status IS NOT DISTINCT FROM \$\{snapshot\.status\}/);
  assert.match(block, /payment_status IS NOT DISTINCT FROM \$\{snapshot\.payment_status\}/);
  assert.match(block, /payment_status_detail IS NOT DISTINCT FROM \$\{snapshot\.payment_status_detail\}/);
  assert.match(block, /shipping_status IS NOT DISTINCT FROM \$\{snapshot\.shipping_status\}/);
  assert.match(block, /shipping_generation_status IS NOT DISTINCT FROM \$\{snapshot\.shipping_generation_status\}/);
  assert.match(block, /orderStatusFromShipping\(snapshot, 'processing'\)/);
});

test('createShipment y su recuperación reutilizan el CAS sin reintentar el alta externa', () => {
  const admin = read('api/admin.js');
  const start = admin.indexOf('async function createShipment');
  const end = admin.indexOf('async function reconcileShipmentCreation', start);
  const block = admin.slice(start, end);
  const uses = block.match(/persistCreatedShipment\(sql/g) || [];
  assert.ok(uses.length >= 2, 'El flujo normal y la recuperación deben usar persistCreatedShipment.');
  assert.match(block, /SHIPMENT_LOCAL_IDENTITY_CONFLICT/);
  assert.match(block, /SHIPMENT_CREATED_PERSISTENCE_RACE/);
  assert.match(block, /persisted\.order\.status/);
  assert.match(block, /persisted\.order\.payment_status === 'approved'/);
  const providerCreates = block.match(/createConfirmedShipment\(/g) || [];
  assert.equal(providerCreates.length, 1, 'La recuperación local no debe crear un segundo shipment externo.');
});
