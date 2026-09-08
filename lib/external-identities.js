function isUniqueViolation(error) {
  return String(error?.code || '') === '23505';
}

async function preferenceOwner(sql, preferenceId, orderId) {
  const rows = await sql`
    SELECT id FROM orders
    WHERE preference_id=${String(preferenceId)} AND id<>${orderId}
    LIMIT 1
  `;
  return rows[0]?.id || null;
}

async function persistPreferenceIdentity(sql, { orderId, preferenceId, paymentUrl }) {
  const existingOwner = await preferenceOwner(sql, preferenceId, orderId);
  if (existingOwner) return { ok: false, conflictOrderId: existingOwner };

  try {
    await sql`
      UPDATE orders SET
        preference_id=${String(preferenceId)},payment_url=${String(paymentUrl)},
        payment_status_detail=NULL,updated_at=NOW()
      WHERE id=${orderId}
    `;
    return { ok: true, conflictOrderId: null };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { ok: false, conflictOrderId: await preferenceOwner(sql, preferenceId, orderId) };
  }
}

async function shipmentOwner(sql, shipmentId, orderId) {
  const rows = await sql`
    SELECT id FROM orders
    WHERE enviopack_shipment_id=${String(shipmentId)} AND id<>${orderId}
    LIMIT 1
  `;
  return rows[0]?.id || null;
}

module.exports = {
  isUniqueViolation,
  persistPreferenceIdentity,
  preferenceOwner,
  shipmentOwner
};
