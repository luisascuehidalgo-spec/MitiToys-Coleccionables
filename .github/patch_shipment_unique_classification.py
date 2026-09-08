from pathlib import Path

p = Path('api/admin.js')
s = p.read_text()

old_import = "const { isUniqueViolation, shipmentOwner } = require('../lib/external-identities');"
new_import = "const { shipmentOwner, shipmentConflictOwner } = require('../lib/external-identities');"
if old_import not in s:
    raise SystemExit('external identities import target missing')
s = s.replace(old_import, new_import, 1)

old = """if(isUniqueViolation(error) && providerShipment?.id) {
  const conflictingShipmentId = String(providerShipment.id);
  const conflictOwner = await shipmentOwner(sql, conflictingShipmentId, id);
  await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('Conflicto de ownership del shipment_id detectado por PostgreSQL. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id}`;
  await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_ownership_conflict',${order.status},${JSON.stringify({ shipment_id: conflictingShipmentId, conflict_order_id: conflictOwner || null, source: 'unique_constraint' })}::jsonb)`;
  throw Object.assign(new Error('El identificador de envío ya está asociado a otro pedido. No vuelvas a generar el envío hasta revisarlo.'), { status: 409, code: 'SHIPMENT_OWNERSHIP_CONFLICT' });
}
if(providerShipment?.id) {
      const recoveredShipmentId = String(providerShipment.id);
      const recoveredProviderState = String(providerShipment.estado || '');
"""
new = """if(providerShipment?.id) {
      const recoveredShipmentId = String(providerShipment.id);
      const conflictOwner = await shipmentConflictOwner(sql, error, recoveredShipmentId, id);
      if (conflictOwner) {
        await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('Conflicto de ownership del shipment_id detectado por PostgreSQL. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id}`;
        await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_ownership_conflict',${order.status},${JSON.stringify({ shipment_id: recoveredShipmentId, conflict_order_id: conflictOwner, source: 'unique_constraint' })}::jsonb)`;
        throw Object.assign(new Error('El identificador de envío ya está asociado a otro pedido. No vuelvas a generar el envío hasta revisarlo.'), { status: 409, code: 'SHIPMENT_OWNERSHIP_CONFLICT' });
      }
      const recoveredProviderState = String(providerShipment.estado || '');
"""
if old not in s:
    raise SystemExit('shipment unique catch block target missing')
s = s.replace(old, new, 1)
p.write_text(s)
