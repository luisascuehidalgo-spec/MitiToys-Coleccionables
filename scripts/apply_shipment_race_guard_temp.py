from pathlib import Path

p = Path('api/webhook-mercadopago.js')
s = p.read_text()
s = s.replace(
    "const { releaseReservedStock } = require('../lib/inventory');",
    "const { releaseReservedStockIfUnshipped } = require('../lib/inventory');",
    1,
)
old = """        if (newStatus === 'cancelled' || newStatus === 'refunded') {
          await releaseReservedStock(
            sql,
            order.id,
            newStatus === 'refunded' ? 'Liberación por reembolso' : 'Liberación por rechazo/cancelación'
          );
        }

        await sql`"""
new = """        let stockRelease = null;
        if (newStatus === 'cancelled' || newStatus === 'refunded') {
          stockRelease = await releaseReservedStockIfUnshipped(
            sql,
            order.id,
            newStatus === 'refunded' ? 'Liberación por reembolso' : 'Liberación por rechazo/cancelación'
          );
        }

        await sql`"""
if old not in s:
    raise SystemExit('webhook stock release block not found')
s = s.replace(old, new, 1)
old_payload = """              currency_id: payment.currency_id || null
            })}::jsonb"""
new_payload = """              currency_id: payment.currency_id || null,
              stock_release: stockRelease
            })}::jsonb"""
if old_payload not in s:
    raise SystemExit('webhook event payload anchor not found')
s = s.replace(old_payload, new_payload, 1)
p.write_text(s)

p = Path('api/admin.js')
s = p.read_text()
s = s.replace(
    "const { releaseReservedStock } = require('../lib/inventory');",
    "const { releaseReservedStockIfUnshipped } = require('../lib/inventory');",
    1,
)
s = s.replace(
    "WHERE id=${id} AND enviopack_shipment_id IS NULL AND shipping_generation_status IN ('not_created','failed')",
    "WHERE id=${id} AND payment_status='approved' AND status NOT IN ('cancelled','refunded') AND enviopack_shipment_id IS NULL AND shipping_generation_status IN ('not_created','failed')",
    1,
)
s = s.replace(
    "if (!claim.length) throw Object.assign(new Error('El envío ya se está generando. Actualizá el panel en unos segundos.'), { status: 409 });",
    "if (!claim.length) throw Object.assign(new Error('El envío ya se está generando o el pago dejó de estar aprobado. Actualizá el panel antes de reintentar.'), { status: 409 });",
    1,
)

provider_anchor = """    await sql`UPDATE orders SET enviopack_order_id=${providerOrderId},updated_at=NOW() WHERE id=${id}`;

    const shipment = await createConfirmedShipment({"""
provider_replacement = """    await sql`UPDATE orders SET enviopack_order_id=${providerOrderId},updated_at=NOW() WHERE id=${id}`;

    const paymentGuard = await sql`SELECT status,payment_status FROM orders WHERE id=${id} LIMIT 1`;
    if (!paymentGuard.length || paymentGuard[0].payment_status !== 'approved' || ['cancelled','refunded'].includes(String(paymentGuard[0].status || ''))) {
      await sql`UPDATE orders SET shipping_generation_status='failed',shipping_last_error='El pago dejó de estar aprobado antes de confirmar el envío.',updated_at=NOW() WHERE id=${id}`;
      const current = paymentGuard[0];
      if (current && ['cancelled','refunded'].includes(String(current.status || ''))) {
        await releaseReservedStockIfUnshipped(sql, id, 'Liberación porque el pago cambió antes de confirmar el envío');
      }
      throw Object.assign(new Error('Mercado Pago cambió el estado del pago antes de confirmar el envío. No se generó el despacho.'), { status: 409 });
    }

    let createdShipment = null;
    const shipment = await createConfirmedShipment({"""
if provider_anchor not in s:
    raise SystemExit('admin provider anchor not found')
s = s.replace(provider_anchor, provider_replacement, 1)

shipment_id_anchor = """    const shipmentId = String(shipment.id);
    const providerShipmentState = String(shipment.estado || '');"""
shipment_id_replacement = """    createdShipment = shipment;
    const shipmentId = String(shipment.id);
    const providerShipmentState = String(shipment.estado || '');"""
if shipment_id_anchor not in s:
    raise SystemExit('admin shipment id anchor not found')
s = s.replace(shipment_id_anchor, shipment_id_replacement, 1)

old_current = """    const nextOrderStatus = orderStatusFromShipping(order.status, order.payment_status, 'processing');
    const nextShippingStatus = shippingStatusFromProvider(order.shipping_status, 'preparing');
    await sql`"""
new_current = """    const currentRows = await sql`SELECT status,payment_status,shipping_status FROM orders WHERE id=${id} LIMIT 1`;
    const currentOrder = currentRows[0] || order;
    const nextOrderStatus = orderStatusFromShipping(currentOrder.status, currentOrder.payment_status, 'processing');
    const nextShippingStatus = shippingStatusFromProvider(currentOrder.shipping_status, 'preparing');
    await sql`"""
if old_current not in s:
    raise SystemExit('admin current state anchor not found')
s = s.replace(old_current, new_current, 1)

old_notify = """    if (trackingNumber) await queueAndSendOrderNotification(sql, id, 'shipment_created');
    return { reused: false, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady };
  } catch (error) {
    await sql`UPDATE orders SET shipping_generation_status='failed',shipping_last_error=${clean(error.message, 1000)},updated_at=NOW() WHERE id=${id}`;
    throw error;
  }"""
new_notify = """    if (trackingNumber && currentOrder.payment_status === 'approved') await queueAndSendOrderNotification(sql, id, 'shipment_created');
    return { reused: false, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady, order_status: nextOrderStatus };
  } catch (error) {
    if (createdShipment?.id) {
      try {
        await sql`UPDATE orders SET enviopack_shipment_id=${String(createdShipment.id)},shipping_generation_status='created',shipping_last_error=${clean(error.message, 1000)},updated_at=NOW() WHERE id=${id}`;
      } catch (_) {}
    } else {
      await sql`UPDATE orders SET shipping_generation_status='failed',shipping_last_error=${clean(error.message, 1000)},updated_at=NOW() WHERE id=${id}`;
      try {
        const terminalRows = await sql`SELECT status FROM orders WHERE id=${id} LIMIT 1`;
        if (terminalRows.length && ['cancelled','refunded'].includes(String(terminalRows[0].status || ''))) {
          await releaseReservedStockIfUnshipped(sql, id, 'Liberación tras fallo de generación de envío con pago terminal');
        }
      } catch (_) {}
    }
    throw error;
  }"""
if old_notify not in s:
    raise SystemExit('admin notification/catch block not found')
s = s.replace(old_notify, new_notify, 1)

old_admin_release = """      if(previous.status!==status && (status==='cancelled'||status==='refunded')) {
        await releaseReservedStock(sql,id,status==='refunded'?'Liberación por reembolso confirmado':'Liberación por cancelación confirmada');
      }
      if(previous.status!==status){
        await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'admin.status_changed',${previous.status},${status},${JSON.stringify({tracking_number:tracking,shipping_carrier:carrier})}::jsonb)`;"""
new_admin_release = """      let stockRelease=null;
      if(previous.status!==status && (status==='cancelled'||status==='refunded')) {
        stockRelease=await releaseReservedStockIfUnshipped(sql,id,status==='refunded'?'Liberación por reembolso confirmado':'Liberación por cancelación confirmada');
      }
      if(previous.status!==status){
        await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'admin.status_changed',${previous.status},${status},${JSON.stringify({tracking_number:tracking,shipping_carrier:carrier,stock_release:stockRelease})}::jsonb)`;"""
if old_admin_release not in s:
    raise SystemExit('admin manual release block not found')
s = s.replace(old_admin_release, new_admin_release, 1)
p.write_text(s)
