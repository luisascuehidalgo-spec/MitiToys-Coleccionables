async function loadAdminOrderSnapshot(sql, id) {
  const rows = await sql`
    SELECT
      status,payment_id,payment_status,payment_status_detail,preference_id,updated_at,
      shipping_status,tracking_number,enviopack_order_id,enviopack_shipment_id,enviopack_state,
      shipping_generation_status,shipping_recipient,shipping_address,shipping_street,shipping_number,
      shipping_floor,shipping_unit,shipping_city,shipping_postal_code,shipping_phone,shipping_notes,shipping_carrier
    FROM orders WHERE id=${id} LIMIT 1
  `;
  return rows[0] || null;
}

async function persistAdminOrderUpdate(sql, {
  id,
  previous,
  status,
  shippingStatus,
  recipient,
  address,
  street,
  number,
  floor,
  unit,
  city,
  postal,
  phone,
  notes,
  carrier,
  tracking
}) {
  const rows = await sql`
    UPDATE orders SET
      status=${status},shipping_status=${shippingStatus},shipping_recipient=${recipient},
      shipping_address=${address || null},shipping_street=${street},shipping_number=${number},
      shipping_floor=${floor},shipping_unit=${unit},shipping_city=${city},shipping_postal_code=${postal},
      shipping_phone=${phone},shipping_notes=${notes},shipping_carrier=${carrier},tracking_number=${tracking},updated_at=NOW()
    WHERE id=${id}
      AND updated_at IS NOT DISTINCT FROM ${previous.updated_at}
      AND status IS NOT DISTINCT FROM ${previous.status}
      AND payment_id IS NOT DISTINCT FROM ${previous.payment_id}
      AND payment_status IS NOT DISTINCT FROM ${previous.payment_status}
      AND payment_status_detail IS NOT DISTINCT FROM ${previous.payment_status_detail}
      AND preference_id IS NOT DISTINCT FROM ${previous.preference_id}
      AND shipping_status IS NOT DISTINCT FROM ${previous.shipping_status}
      AND tracking_number IS NOT DISTINCT FROM ${previous.tracking_number}
      AND enviopack_order_id IS NOT DISTINCT FROM ${previous.enviopack_order_id}
      AND enviopack_shipment_id IS NOT DISTINCT FROM ${previous.enviopack_shipment_id}
      AND enviopack_state IS NOT DISTINCT FROM ${previous.enviopack_state}
      AND shipping_generation_status IS NOT DISTINCT FROM ${previous.shipping_generation_status}
      AND shipping_recipient IS NOT DISTINCT FROM ${previous.shipping_recipient}
      AND shipping_address IS NOT DISTINCT FROM ${previous.shipping_address}
      AND shipping_street IS NOT DISTINCT FROM ${previous.shipping_street}
      AND shipping_number IS NOT DISTINCT FROM ${previous.shipping_number}
      AND shipping_floor IS NOT DISTINCT FROM ${previous.shipping_floor}
      AND shipping_unit IS NOT DISTINCT FROM ${previous.shipping_unit}
      AND shipping_city IS NOT DISTINCT FROM ${previous.shipping_city}
      AND shipping_postal_code IS NOT DISTINCT FROM ${previous.shipping_postal_code}
      AND shipping_phone IS NOT DISTINCT FROM ${previous.shipping_phone}
      AND shipping_notes IS NOT DISTINCT FROM ${previous.shipping_notes}
      AND shipping_carrier IS NOT DISTINCT FROM ${previous.shipping_carrier}
    RETURNING *
  `;
  if (rows.length) return { ok: true, order: rows[0] };

  const currentRows = await sql`
    SELECT status,payment_id,payment_status,payment_status_detail,updated_at,
      shipping_status,tracking_number,enviopack_order_id,enviopack_shipment_id,enviopack_state,shipping_generation_status
    FROM orders WHERE id=${id} LIMIT 1
  `;
  return { ok: false, current: currentRows[0] || null };
}

module.exports = { loadAdminOrderSnapshot, persistAdminOrderUpdate };
