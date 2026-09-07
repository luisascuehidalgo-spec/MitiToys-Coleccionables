async function orderItems(sql, orderId) {
  const items = await sql`SELECT product_id,quantity FROM order_items WHERE order_id=${orderId} ORDER BY id`;
  if (items.length) return items;
  return sql`SELECT product_id,quantity FROM orders WHERE id=${orderId} LIMIT 1`;
}

async function releaseReservedStock(sql, orderId, reason = 'Liberación de stock') {
  const items = await orderItems(sql, orderId);
  const released = [];

  for (const item of items) {
    const rows = await sql`
      WITH inserted_release AS (
        INSERT INTO inventory_movements(product_id,order_id,movement_type,quantity,reason)
        SELECT ${item.product_id},${orderId},'release',${item.quantity},${reason}
        WHERE EXISTS (
          SELECT 1 FROM inventory_movements
          WHERE order_id=${orderId} AND product_id=${item.product_id}
            AND movement_type='reserve' AND quantity<0
        )
        ON CONFLICT (order_id,product_id,movement_type)
          WHERE order_id IS NOT NULL AND movement_type='release'
        DO NOTHING
        RETURNING product_id,quantity
      )
      UPDATE products p
      SET stock_quantity=p.stock_quantity+r.quantity,updated_at=NOW()
      FROM inserted_release r
      WHERE p.id=r.product_id
      RETURNING p.id,r.quantity
    `;
    if (rows.length) released.push({ product_id: rows[0].id, quantity: Number(rows[0].quantity) });
  }

  return released;
}

async function releaseReservedStockIfUnshipped(sql, orderId, reason = 'Liberación de stock') {
  const rows = await sql`
    SELECT shipping_status,shipping_generation_status,enviopack_shipment_id
    FROM orders WHERE id=${orderId} LIMIT 1
  `;
  if (!rows.length) return { released: [], skipped: 'order_missing' };

  const order = rows[0];
  const shippingStatus = String(order.shipping_status || '').toLowerCase();
  const generationStatus = String(order.shipping_generation_status || '').toLowerCase();
  const shipmentStarted = Boolean(order.enviopack_shipment_id)
    || ['processing', 'created'].includes(generationStatus)
    || ['in_transit', 'delivered'].includes(shippingStatus);

  if (shipmentStarted) return { released: [], skipped: 'shipment_started' };

  const released = await releaseReservedStock(sql, orderId, reason);
  return { released, skipped: null };
}

module.exports = { releaseReservedStock, releaseReservedStockIfUnshipped };
