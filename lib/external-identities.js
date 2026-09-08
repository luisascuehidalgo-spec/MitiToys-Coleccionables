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

async function persistPreferenceIdentity(sql, {
  orderId,
  preferenceId,
  paymentUrl,
  pendingUnlinkedOnly = false
}) {
  const normalizedPreferenceId = String(preferenceId);
  const existingOwner = await preferenceOwner(sql, normalizedPreferenceId, orderId);
  if (existingOwner) return { ok: false, conflictOrderId: existingOwner, skipped: false };

  try {
    let rows;
    if (pendingUnlinkedOnly) {
      rows = await sql`
        UPDATE orders SET
          preference_id=${normalizedPreferenceId},payment_url=${String(paymentUrl)},
          payment_status_detail=NULL,updated_at=NOW()
        WHERE id=${orderId} AND status='pending' AND payment_id IS NULL
          AND payment_url IS NULL AND preference_id IS NULL
        RETURNING id,preference_id
      `;
    } else {
      rows = await sql`
        UPDATE orders SET
          preference_id=${normalizedPreferenceId},payment_url=${String(paymentUrl)},
          payment_status_detail=NULL,updated_at=NOW()
        WHERE id=${orderId} AND (preference_id IS NULL OR preference_id=${normalizedPreferenceId})
        RETURNING id,preference_id
      `;
    }

    if (rows.length) return { ok: true, conflictOrderId: null, skipped: false };

    const current = await sql`SELECT id,preference_id FROM orders WHERE id=${orderId} LIMIT 1`;
    if (String(current[0]?.preference_id || '') === normalizedPreferenceId) {
      return { ok: true, conflictOrderId: null, skipped: false, alreadyPersisted: true };
    }
    return { ok: false, conflictOrderId: null, skipped: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return {
      ok: false,
      conflictOrderId: await preferenceOwner(sql, normalizedPreferenceId, orderId),
      skipped: false
    };
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
