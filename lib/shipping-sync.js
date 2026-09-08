const { orderStatusFromShipping, shippingStatusFromProvider } = require('./order-state');

async function readShippingSnapshot(sql, orderId) {
  const rows = await sql`
    SELECT id,status,payment_status,payment_status_detail,shipping_status,tracking_number,
      enviopack_shipment_id,shipping_generation_status
    FROM orders WHERE id=${orderId} LIMIT 1
  `;
  return rows[0] || null;
}

function boundedAttempts(attempts) {
  return Math.max(1, Math.min(3, Number(attempts) || 2));
}

async function persistShippingObservation(sql, {
  orderId,
  providerState,
  trackingNumber,
  labelReady,
  proposedOrderStatus,
  proposedShippingStatus,
  attempts = 2
}) {
  const maxAttempts = boundedAttempts(attempts);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readShippingSnapshot(sql, orderId);
    if (!snapshot) return { ok: false, reason: 'missing', current: null };

    const nextOrderStatus = orderStatusFromShipping(snapshot, proposedOrderStatus);
    const nextShippingStatus = shippingStatusFromProvider(snapshot.shipping_status, proposedShippingStatus);
    const updated = await sql`
      UPDATE orders SET
        enviopack_state=${providerState || null},
        tracking_number=${trackingNumber || null},
        shipping_label_ready=${Boolean(labelReady)},
        shipping_status=${nextShippingStatus},
        status=${nextOrderStatus},
        shipping_last_synced_at=NOW(),
        shipping_last_error=NULL,
        updated_at=NOW()
      WHERE id=${orderId}
        AND status IS NOT DISTINCT FROM ${snapshot.status}
        AND payment_status IS NOT DISTINCT FROM ${snapshot.payment_status}
        AND payment_status_detail IS NOT DISTINCT FROM ${snapshot.payment_status_detail}
        AND shipping_status IS NOT DISTINCT FROM ${snapshot.shipping_status}
      RETURNING id,status,payment_status,payment_status_detail,shipping_status,tracking_number,
        enviopack_shipment_id,shipping_generation_status
    `;

    if (updated.length) {
      return {
        ok: true,
        before: snapshot,
        order: updated[0],
        orderStatus: nextOrderStatus,
        shippingStatus: nextShippingStatus,
        retries: attempt
      };
    }
  }

  return { ok: false, reason: 'race', current: await readShippingSnapshot(sql, orderId) };
}

async function persistCreatedShipment(sql, {
  orderId,
  shipmentId,
  providerState,
  trackingNumber,
  labelReady,
  destination = {},
  lastError = null,
  attempts = 2
}) {
  const id = String(shipmentId || '').trim();
  if (!id) return { ok: false, reason: 'missing_shipment_id', current: null };
  const maxAttempts = boundedAttempts(attempts);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readShippingSnapshot(sql, orderId);
    if (!snapshot) return { ok: false, reason: 'missing', current: null };

    const currentShipmentId = String(snapshot.enviopack_shipment_id || '').trim();
    if (currentShipmentId && currentShipmentId !== id) {
      return { ok: false, reason: 'identity_conflict', current: snapshot };
    }
    if (String(snapshot.shipping_generation_status || '') === 'conflict') {
      return { ok: false, reason: 'generation_conflict', current: snapshot };
    }

    const nextOrderStatus = orderStatusFromShipping(snapshot, 'processing');
    const nextShippingStatus = shippingStatusFromProvider(snapshot.shipping_status, 'preparing');
    const updated = await sql`
      UPDATE orders SET
        enviopack_shipment_id=COALESCE(enviopack_shipment_id,${id}),
        enviopack_state=${providerState || null},
        shipping_destination_type=COALESCE(${destination.type || null},shipping_destination_type),
        shipping_street=COALESCE(${destination.street || null},shipping_street),
        shipping_number=COALESCE(${destination.number || null},shipping_number),
        shipping_branch_id=COALESCE(${destination.branchId || null},shipping_branch_id),
        shipping_branch_name=COALESCE(${destination.branchName || null},shipping_branch_name),
        shipping_branch_address=COALESCE(${destination.branchAddress || null},shipping_branch_address),
        tracking_number=COALESCE(${trackingNumber || null},tracking_number),
        shipping_label_ready=${Boolean(labelReady)},
        shipping_generation_status='created',
        shipping_status=${nextShippingStatus},
        status=${nextOrderStatus},
        shipping_created_at=COALESCE(shipping_created_at,NOW()),
        shipping_last_synced_at=NOW(),
        shipping_last_error=${lastError || null},
        updated_at=NOW()
      WHERE id=${orderId}
        AND (enviopack_shipment_id IS NULL OR enviopack_shipment_id=${id})
        AND status IS NOT DISTINCT FROM ${snapshot.status}
        AND payment_status IS NOT DISTINCT FROM ${snapshot.payment_status}
        AND payment_status_detail IS NOT DISTINCT FROM ${snapshot.payment_status_detail}
        AND shipping_status IS NOT DISTINCT FROM ${snapshot.shipping_status}
        AND shipping_generation_status IS NOT DISTINCT FROM ${snapshot.shipping_generation_status}
      RETURNING id,status,payment_status,payment_status_detail,shipping_status,tracking_number,
        enviopack_shipment_id,shipping_generation_status
    `;

    if (updated.length) {
      return {
        ok: true,
        before: snapshot,
        order: updated[0],
        orderStatus: nextOrderStatus,
        shippingStatus: nextShippingStatus,
        retries: attempt
      };
    }
  }

  return { ok: false, reason: 'race', current: await readShippingSnapshot(sql, orderId) };
}

module.exports = { readShippingSnapshot, persistShippingObservation, persistCreatedShipment };
