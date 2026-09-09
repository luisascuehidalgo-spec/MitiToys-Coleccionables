const { orderStatusFromShipping, shippingStatusFromProvider } = require('./order-state');

async function readShippingSnapshot(sql, orderId) {
  const rows = await sql`
    SELECT id,status,payment_status,payment_status_detail,shipping_status,tracking_number,
      enviopack_shipment_id,enviopack_state,shipping_label_ready,shipping_generation_status,
      shipping_last_error,shipping_last_synced_at
    FROM orders WHERE id=${orderId} LIMIT 1
  `;
  return rows[0] || null;
}

function boundedAttempts(attempts) {
  return Math.max(1, Math.min(3, Number(attempts) || 2));
}

function normalizedNullable(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function shippingObservationChanged(snapshot, {
  providerState,
  trackingNumber,
  labelReady,
  nextOrderStatus,
  nextShippingStatus
}) {
  return normalizedNullable(snapshot?.enviopack_state) !== normalizedNullable(providerState)
    || normalizedNullable(snapshot?.tracking_number) !== normalizedNullable(trackingNumber)
    || Boolean(snapshot?.shipping_label_ready) !== Boolean(labelReady)
    || String(snapshot?.status || '') !== String(nextOrderStatus || '')
    || String(snapshot?.shipping_status || '') !== String(nextShippingStatus || '')
    || Boolean(snapshot?.shipping_last_error);
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
    const changed = shippingObservationChanged(snapshot, {
      providerState,
      trackingNumber,
      labelReady,
      nextOrderStatus,
      nextShippingStatus
    });

    if (!changed) {
      const heartbeat = await sql`
        UPDATE orders SET shipping_last_synced_at=NOW()
        WHERE id=${orderId}
          AND status IS NOT DISTINCT FROM ${snapshot.status}
          AND payment_status IS NOT DISTINCT FROM ${snapshot.payment_status}
          AND payment_status_detail IS NOT DISTINCT FROM ${snapshot.payment_status_detail}
          AND shipping_status IS NOT DISTINCT FROM ${snapshot.shipping_status}
          AND tracking_number IS NOT DISTINCT FROM ${snapshot.tracking_number}
          AND enviopack_state IS NOT DISTINCT FROM ${snapshot.enviopack_state}
          AND shipping_label_ready IS NOT DISTINCT FROM ${snapshot.shipping_label_ready}
        RETURNING id,status,payment_status,payment_status_detail,shipping_status,tracking_number,
          enviopack_shipment_id,enviopack_state,shipping_label_ready,shipping_generation_status,
          shipping_last_error,shipping_last_synced_at
      `;
      if (heartbeat.length) {
        return {
          ok: true,
          unchanged: true,
          before: snapshot,
          order: heartbeat[0],
          orderStatus: nextOrderStatus,
          shippingStatus: nextShippingStatus,
          retries: attempt
        };
      }
      continue;
    }

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
        enviopack_shipment_id,enviopack_state,shipping_label_ready,shipping_generation_status,
        shipping_last_error,shipping_last_synced_at
    `;

    if (updated.length) {
      return {
        ok: true,
        unchanged: false,
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
  proposedOrderStatus = null,
  proposedShippingStatus = null,
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

    const nextOrderStatus = proposedOrderStatus
      ? orderStatusFromShipping(snapshot, proposedOrderStatus)
      : orderStatusFromShipping(snapshot, 'processing');
    const nextShippingStatus = proposedShippingStatus
      ? shippingStatusFromProvider(snapshot.shipping_status, proposedShippingStatus)
      : shippingStatusFromProvider(snapshot.shipping_status, 'preparing');
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
        enviopack_shipment_id,enviopack_state,shipping_label_ready,shipping_generation_status,
        shipping_last_error,shipping_last_synced_at
    `;

    if (updated.length) {
      return {
        ok: true,
        reused: currentShipmentId === id,
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

module.exports = { readShippingSnapshot, shippingObservationChanged, persistShippingObservation, persistCreatedShipment };
