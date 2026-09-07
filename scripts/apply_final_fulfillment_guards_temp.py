from pathlib import Path

p = Path('api/admin.js')
s = p.read_text()
claim = """  if (!claim.length) throw Object.assign(new Error('El envío ya se está generando o el pago dejó de estar aprobado. Actualizá el panel antes de reintentar.'), { status: 409 });

  try {"""
replacement = """  if (!claim.length) throw Object.assign(new Error('El envío ya se está generando o el pago dejó de estar aprobado. Actualizá el panel antes de reintentar.'), { status: 409 });

  let createdShipment = null;
  try {"""
if claim not in s:
    raise SystemExit('createdShipment outer-scope anchor not found')
s = s.replace(claim, replacement, 1)
inner = """    let createdShipment = null;
    const shipment = await createConfirmedShipment({"""
if inner not in s:
    raise SystemExit('createdShipment inner declaration not found')
s = s.replace(inner, """    const shipment = await createConfirmedShipment({""", 1)
old_notify = "if (trackingNumber && trackingNumber !== order.tracking_number) await queueAndSendOrderNotification(sql, id, 'shipment_created');"
new_notify = "if (trackingNumber && trackingNumber !== order.tracking_number && order.payment_status === 'approved') await queueAndSendOrderNotification(sql, id, 'shipment_created');"
if old_notify not in s:
    raise SystemExit('admin sync notification anchor not found')
s = s.replace(old_notify, new_notify, 1)
p.write_text(s)

p = Path('api/envios.js')
s = p.read_text()
old = "if (trackingNumber && trackingNumber !== orders[0].tracking_number) await queueAndSendOrderNotification(sql, orders[0].id, 'shipment_created');"
new = "if (trackingNumber && trackingNumber !== orders[0].tracking_number && orders[0].payment_status === 'approved') await queueAndSendOrderNotification(sql, orders[0].id, 'shipment_created');"
if old not in s:
    raise SystemExit('envios webhook notification anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)
