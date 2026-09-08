from pathlib import Path

p = Path('api/admin.js')
s = p.read_text()

old = """    if (providerShipmentsBefore.length === 1) {
      shipment = await getShipment(providerShipmentsBefore[0].id);
      reusedProviderShipment = true;
    } else {
"""
new = """    if (providerShipmentsBefore.length === 1) {
      shipment = providerShipmentsBefore[0];
      try { shipment = await getShipment(providerShipmentsBefore[0].id); }
      catch (detailsError) { console.warn('existing shipment details unavailable:', 'code=' + String(detailsError?.code || detailsError?.name || 'DETAILS_ERROR'), 'status=' + String(detailsError?.providerStatus || 'unknown')); }
      reusedProviderShipment = true;
    } else {
"""
if old not in s:
    raise SystemExit('existing provider shipment fallback target missing')
s = s.replace(old, new, 1)

old = """  const details = await getShipment(shipmentId);
  const trackingNumber = clean(details?.tracking_number || details?.numero_tracking, 120) || null;
  const providerShipmentState = String(details?.estado || shipments[0]?.estado || '');
  const state = providerState(details, []);
  state.order = orderStatusFromShipping(order, state.order);
  state.shipping = shippingStatusFromProvider(order.shipping_status, state.shipping);
  const labelReady = providerShipmentState.toUpperCase() === 'P';
"""
new = """  let details = shipments[0];
  try { details = await getShipment(shipmentId); }
  catch (detailsError) { console.warn('reconciled shipment details unavailable:', 'code=' + String(detailsError?.code || detailsError?.name || 'DETAILS_ERROR'), 'status=' + String(detailsError?.providerStatus || 'unknown')); }
  const trackingNumber = clean(details?.tracking_number || details?.numero_tracking, 120) || null;
  const providerShipmentState = String(details?.estado || shipments[0]?.estado || '');
  const state = providerState(details, []);
  const currentRows = await sql`SELECT status,payment_status,shipping_status FROM orders WHERE id=${id} LIMIT 1`;
  const currentOrder = currentRows[0] || order;
  state.order = orderStatusFromShipping(currentOrder, state.order);
  state.shipping = shippingStatusFromProvider(currentOrder.shipping_status, state.shipping);
  const labelReady = providerShipmentState.toUpperCase() === 'P';
"""
if old not in s:
    raise SystemExit('reconciliation current-state refresh target missing')
s = s.replace(old, new, 1)

old = """      WHERE id=${id} AND enviopack_shipment_id IS NULL
        AND shipping_generation_status IN ('uncertain','processing','failed','not_created')
      RETURNING status,payment_status
"""
new = """      WHERE id=${id} AND enviopack_shipment_id IS NULL
        AND shipping_generation_status IN ('uncertain','processing','failed','not_created')
        AND payment_status IS NOT DISTINCT FROM ${currentOrder.payment_status}
        AND status=${currentOrder.status}
      RETURNING status,payment_status
"""
if old not in s:
    raise SystemExit('reconciliation optimistic state guard target missing')
s = s.replace(old, new, 1)

p.write_text(s)

# Extend regression coverage for fallback identity persistence and payment/status race protection.
t = Path('test/shipment-timeout-reconciliation.test.js')
txt = t.read_text()
old = """  assert.match(admin, /shipping_created_at=COALESCE\\(shipping_created_at,NOW\\(\\)\\)/);
  assert.match(admin, /SHIPMENT_RECONCILIATION_RACE/);
"""
new = """  assert.match(admin, /shipping_created_at=COALESCE\\(shipping_created_at,NOW\\(\\)\\)/);
  assert.match(admin, /shipment = providerShipmentsBefore\\[0\\]/);
  assert.match(admin, /let details = shipments\\[0\\]/);
  assert.match(admin, /payment_status IS NOT DISTINCT FROM \\$\\{currentOrder\\.payment_status\\}/);
  assert.match(admin, /AND status=\\$\\{currentOrder\\.status\\}/);
  assert.match(admin, /SHIPMENT_RECONCILIATION_RACE/);
"""
if old not in txt:
    raise SystemExit('reconciliation state guard test target missing')
t.write_text(txt.replace(old, new, 1))
