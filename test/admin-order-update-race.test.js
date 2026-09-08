const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadAdminOrderSnapshot, persistAdminOrderUpdate } = require('../lib/admin-order-update');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function oldSnapshot() {
  return {
    status: 'pending',
    payment_id: null,
    payment_status: 'pending',
    payment_status_detail: null,
    preference_id: 'pref-1',
    updated_at: '2026-09-08T18:00:00.000Z',
    shipping_status: 'not_shipped',
    tracking_number: null,
    enviopack_order_id: null,
    enviopack_shipment_id: null,
    enviopack_state: null,
    shipping_generation_status: 'not_created',
    shipping_recipient: 'Cliente',
    shipping_address: 'Calle 1',
    shipping_street: 'Calle',
    shipping_number: '1',
    shipping_floor: null,
    shipping_unit: null,
    shipping_city: 'CABA',
    shipping_postal_code: '1000',
    shipping_phone: '1111',
    shipping_notes: null,
    shipping_carrier: null
  };
}

test('CAS rechaza cancelación admin si Mercado Pago aprobó después del snapshot', async () => {
  const previous = oldSnapshot();
  let updateCalls = 0;
  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('UPDATE orders SET')) {
      updateCalls += 1;
      return [];
    }
    if (text.includes('SELECT status,payment_id,payment_status,payment_status_detail,updated_at')) {
      return [{
        status: 'approved',
        payment_id: 'pay-1',
        payment_status: 'approved',
        payment_status_detail: 'accredited',
        updated_at: '2026-09-08T18:00:01.000Z',
        shipping_status: 'not_shipped',
        tracking_number: null,
        enviopack_order_id: null,
        enviopack_shipment_id: null,
        enviopack_state: null,
        shipping_generation_status: 'not_created'
      }];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const result = await persistAdminOrderUpdate(sql, {
    id: 77,
    previous,
    status: 'cancelled',
    shippingStatus: 'not_shipped',
    recipient: previous.shipping_recipient,
    address: previous.shipping_address,
    street: previous.shipping_street,
    number: previous.shipping_number,
    floor: null,
    unit: null,
    city: previous.shipping_city,
    postal: previous.shipping_postal_code,
    phone: previous.shipping_phone,
    notes: null,
    carrier: null,
    tracking: null
  });

  assert.equal(updateCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.current.payment_status, 'approved');
  assert.equal(result.current.status, 'approved');
});

test('CAS rechaza overwrite si Enviopack avanzó tracking durante edición manual', async () => {
  const previous = oldSnapshot();
  previous.status = 'processing';
  previous.payment_id = 'pay-1';
  previous.payment_status = 'approved';
  previous.shipping_status = 'preparing';
  previous.enviopack_order_id = 'ord-1';
  previous.enviopack_shipment_id = 'ship-1';
  previous.shipping_generation_status = 'created';

  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('UPDATE orders SET')) return [];
    if (text.includes('SELECT status,payment_id,payment_status,payment_status_detail,updated_at')) {
      return [{
        ...previous,
        status: 'shipped',
        shipping_status: 'in_transit',
        tracking_number: 'TRACK-NEW',
        updated_at: '2026-09-08T18:01:00.000Z'
      }];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const result = await persistAdminOrderUpdate(sql, {
    id: 88,
    previous,
    status: 'processing',
    shippingStatus: 'preparing',
    recipient: previous.shipping_recipient,
    address: previous.shipping_address,
    street: previous.shipping_street,
    number: previous.shipping_number,
    floor: null,
    unit: null,
    city: previous.shipping_city,
    postal: previous.shipping_postal_code,
    phone: previous.shipping_phone,
    notes: null,
    carrier: null,
    tracking: null
  });

  assert.equal(result.ok, false);
  assert.equal(result.current.shipping_status, 'in_transit');
  assert.equal(result.current.tracking_number, 'TRACK-NEW');
});

test('helper compara versión, pago, shipping, identidad externa y campos editables', () => {
  const source = read('lib/admin-order-update.js');
  for (const field of [
    'updated_at','status','payment_id','payment_status','payment_status_detail','preference_id',
    'shipping_status','tracking_number','enviopack_order_id','enviopack_shipment_id','enviopack_state',
    'shipping_generation_status','shipping_recipient','shipping_address','shipping_street','shipping_number',
    'shipping_floor','shipping_unit','shipping_city','shipping_postal_code','shipping_phone','shipping_notes','shipping_carrier'
  ]) {
    assert.match(source, new RegExp(`${field} IS NOT DISTINCT FROM`), `Falta CAS para ${field}`);
  }
});

test('api admin aborta con 409 antes de stock, eventos o emails si pierde el CAS', () => {
  const admin = read('api/admin.js');
  assert.match(admin, /loadAdminOrderSnapshot/);
  assert.match(admin, /persistAdminOrderUpdate/);
  const start = admin.indexOf("if(req.method==='PATCH')");
  const end = admin.indexOf("if(req.method==='PUT')", start);
  const block = admin.slice(start, end);
  const persistIndex = block.indexOf('persistAdminOrderUpdate');
  const raceIndex = block.indexOf('ORDER_CHANGED_DURING_ADMIN_UPDATE');
  const releaseIndex = block.indexOf('releaseReservedStockIfUnshipped');
  const eventIndex = block.indexOf("'admin.status_changed'");
  const notificationIndex = block.indexOf('queueAndSendOrderNotification');
  assert.ok(persistIndex >= 0);
  assert.ok(raceIndex > persistIndex);
  assert.ok(releaseIndex > raceIndex);
  assert.ok(eventIndex > raceIndex);
  assert.ok(notificationIndex > raceIndex);
});
