function normalizeNullable(value) {
  return value == null || value === '' ? null : String(value);
}

function paymentState(row) {
  return {
    status: String(row?.status || 'pending'),
    payment_id: normalizeNullable(row?.payment_id),
    payment_status: normalizeNullable(row?.payment_status),
    payment_status_detail: normalizeNullable(row?.payment_status_detail)
  };
}

function samePaymentState(left, right) {
  const a = paymentState(left);
  const b = paymentState(right);
  return a.status === b.status
    && a.payment_id === b.payment_id
    && a.payment_status === b.payment_status
    && a.payment_status_detail === b.payment_status_detail;
}

async function resolvePaymentCas(sql, order, expected, changedRows) {
  if (Array.isArray(changedRows) && changedRows.length) {
    return { changed: true, duplicate: false, current: paymentState(expected) };
  }

  const rows = await sql`
    SELECT status,payment_id,payment_status,payment_status_detail
    FROM orders WHERE id=${order.id} LIMIT 1
  `;
  const current = rows[0] || null;
  if (current && samePaymentState(current, expected)) {
    return { changed: false, duplicate: true, current: paymentState(current) };
  }

  throw Object.assign(
    new Error('El pedido cambió mientras se procesaba el pago.'),
    { code: 'PAYMENT_ORDER_RACE', status: 409 }
  );
}

module.exports = {
  paymentState,
  samePaymentState,
  resolvePaymentCas
};
