const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shippingObservationChanged } = require('../lib/shipping-sync');

const baseSnapshot = {
  status: 'shipped',
  payment_status: 'approved',
  payment_status_detail: null,
  shipping_status: 'in_transit',
  tracking_number: 'TRACK-123',
  enviopack_state: 'P',
  shipping_label_ready: true,
  shipping_last_error: null
};

test('identical provider shipping observation is a no-op', () => {
  assert.equal(shippingObservationChanged(baseSnapshot, {
    providerState: 'P',
    trackingNumber: 'TRACK-123',
    labelReady: true,
    nextOrderStatus: 'shipped',
    nextShippingStatus: 'in_transit'
  }), false);
});

test('provider shipping observation changes when functional state changes', () => {
  assert.equal(shippingObservationChanged(baseSnapshot, {
    providerState: 'P',
    trackingNumber: 'TRACK-456',
    labelReady: true,
    nextOrderStatus: 'shipped',
    nextShippingStatus: 'in_transit'
  }), true);
  assert.equal(shippingObservationChanged(baseSnapshot, {
    providerState: 'P',
    trackingNumber: 'TRACK-123',
    labelReady: true,
    nextOrderStatus: 'delivered',
    nextShippingStatus: 'delivered'
  }), true);
});

test('an existing shipping error is cleared by a matching successful observation', () => {
  assert.equal(shippingObservationChanged({ ...baseSnapshot, shipping_last_error: 'provider timeout' }, {
    providerState: 'P',
    trackingNumber: 'TRACK-123',
    labelReady: true,
    nextOrderStatus: 'shipped',
    nextShippingStatus: 'in_transit'
  }), true);
});

test('webhook sync suppresses audit/event side effects for unchanged observations', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'envios.js'), 'utf8');
  assert.match(source, /if\s*\(persisted\.unchanged\)/);
  const unchangedIndex = source.indexOf('if (persisted.unchanged)');
  const eventIndex = source.indexOf("'enviopack.synced'");
  assert.ok(unchangedIndex >= 0 && eventIndex > unchangedIndex, 'unchanged observations must return before enviopack.synced is inserted');
});
