from pathlib import Path

p = Path('api/admin.js')
s = p.read_text()

old = """  if (newShipments.length === 1) {
    try { providerShipment = await getShipment(newShipments[0].id); }
    catch (recoveryError) { console.warn('shipment timeout recovery fetch failed:', 'code=' + String(recoveryError?.code || recoveryError?.name || 'RECOVERY_ERROR')); }
  }
  if (!providerShipment) {
"""
new = """  if (newShipments.length === 1) {
    return reconcileShipmentCreation(sql, id);
  }
  if (!providerShipment) {
"""
if old not in s:
    raise SystemExit('immediate timeout reconciliation target missing')
s = s.replace(old, new, 1)

old = """  const updated = await sql`
    UPDATE orders SET enviopack_shipment_id=${shipmentId},enviopack_state=${providerShipmentState || null},
      tracking_number=${trackingNumber},shipping_label_ready=${labelReady},shipping_generation_status='created',
      shipping_status=${state.shipping},status=${state.order},shipping_last_synced_at=NOW(),shipping_last_error=NULL,updated_at=NOW()
    WHERE id=${id}
    RETURNING status,payment_status
  `;
  await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'enviopack.shipment_reconciled',${order.status},${state.order},${JSON.stringify({ provider_order_id: order.enviopack_order_id, shipment_id: shipmentId, provider_state: providerShipmentState })}::jsonb)`;
  if (trackingNumber && updated[0]?.payment_status === 'approved') await queueAndSendOrderNotification(sql, id, 'shipment_created');
  return { found: true, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady, order_status: state.order };
"""
new = """  let updated;
  try {
    updated = await sql`
      UPDATE orders SET enviopack_shipment_id=${shipmentId},enviopack_state=${providerShipmentState || null},
        tracking_number=${trackingNumber},shipping_label_ready=${labelReady},shipping_generation_status='created',
        shipping_status=${state.shipping},status=${state.order},shipping_created_at=COALESCE(shipping_created_at,NOW()),
        shipping_last_synced_at=NOW(),shipping_last_error=NULL,updated_at=NOW()
      WHERE id=${id} AND enviopack_shipment_id IS NULL
        AND shipping_generation_status IN ('uncertain','processing','failed','not_created')
      RETURNING status,payment_status
    `;
  } catch (error) {
    const raceOwner = await shipmentConflictOwner(sql, error, shipmentId, id);
    if (raceOwner) {
      const marked = await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('El envío encontrado en Envíopack fue asociado a otro pedido durante la reconciliación. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id} AND shipping_generation_status IS DISTINCT FROM 'conflict' RETURNING id`;
      if (marked.length) await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_ownership_conflict',${order.status},${JSON.stringify({ shipment_id: shipmentId, conflict_order_id: raceOwner, source: 'reconciliation_unique_race' })}::jsonb)`;
      throw Object.assign(new Error('El envío fue asociado a otro pedido durante la reconciliación. Requiere revisión manual.'), { status: 409, code: 'SHIPMENT_OWNERSHIP_CONFLICT' });
    }
    throw error;
  }

  if (!updated.length) {
    const currentRows = await sql`SELECT enviopack_shipment_id,tracking_number,shipping_label_ready,status FROM orders WHERE id=${id} LIMIT 1`;
    const current = currentRows[0] || null;
    if (String(current?.enviopack_shipment_id || '') === shipmentId) {
      return { found: true, reused: true, shipment_id: shipmentId, tracking_number: current.tracking_number || trackingNumber, label_ready: Boolean(current.shipping_label_ready), order_status: current.status || state.order };
    }
    throw Object.assign(new Error('El pedido cambió mientras se verificaba Envíopack. Actualizá el panel antes de continuar.'), { status: 409, code: 'SHIPMENT_RECONCILIATION_RACE' });
  }

  await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'enviopack.shipment_reconciled',${order.status},${state.order},${JSON.stringify({ provider_order_id: order.enviopack_order_id, shipment_id: shipmentId, provider_state: providerShipmentState })}::jsonb)`;
  if (trackingNumber && updated[0]?.payment_status === 'approved') await queueAndSendOrderNotification(sql, id, 'shipment_created');
  return { found: true, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady, order_status: state.order };
"""
if old not in s:
    raise SystemExit('reconciliation persistence target missing')
s = s.replace(old, new, 1)

p.write_text(s)

# Strengthen static regression around the concurrency/idempotency guarantees.
t = Path('test/shipment-timeout-reconciliation.test.js')
txt = t.read_text()
old = """  assert.match(admin, /async function reconcileShipmentCreation/);
  assert.match(ui, /\\['not_created','failed'\\]\\.includes\\(String\\(o\\.shipping_generation_status\\|\\|'not_created'\\)\\)/);
"""
new = """  assert.match(admin, /async function reconcileShipmentCreation/);
  assert.match(admin, /return reconcileShipmentCreation\\(sql, id\\)/);
  assert.match(admin, /WHERE id=\\$\\{id\\} AND enviopack_shipment_id IS NULL/);
  assert.match(admin, /shipping_created_at=COALESCE\\(shipping_created_at,NOW\\(\\)\\)/);
  assert.match(admin, /SHIPMENT_RECONCILIATION_RACE/);
  assert.match(admin, /source: 'reconciliation_unique_race'/);
  assert.match(ui, /\\['not_created','failed'\\]\\.includes\\(String\\(o\\.shipping_generation_status\\|\\|'not_created'\\)\\)/);
"""
if old not in txt:
    raise SystemExit('reconciliation static regression target missing')
t.write_text(txt.replace(old, new, 1))
