const { orderStatusFromShipping, shippingStatusFromProvider } = require('./order-state');

async function readShippingSnapshot(sql, orderId) {
  const rows = await sql`
    SELECT id,status,payment_status,payment_status_detail,shipping_status,tracking_number
    FROM orders WHERE id=${orderId} LIMIT 1
  `;
  return rows[0] || null;
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
  const maxAttempts = Math.max(1, Math.min(3, Number(attempts) || 2));

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
      RETURNING id,status,payment_status,payment_status_detail,shipping_status,tracking_number
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

module.exports = { readShippingSnapshot, persistShippingObservation };
