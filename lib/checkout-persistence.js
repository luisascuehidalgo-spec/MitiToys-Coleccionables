const { reserveStockQuery } = require('./inventory');

async function allocateOrderId(sql) {
  const rows = await sql`SELECT nextval(pg_get_serial_sequence('orders','id'))::bigint AS id`;
  const orderId = Number(rows[0]?.id);
  if (!Number.isInteger(orderId) || orderId < 1) {
    throw Object.assign(new Error('No se pudo reservar el identificador del pedido.'), { code: 'ORDER_ID_ALLOCATION_FAILED' });
  }
  return orderId;
}

function expectedItemsJson(items) {
  return JSON.stringify(items.map(item => ({
    product_id: String(item.id),
    quantity: Number(item.qty),
    unit_price: Number(item.price),
    total_amount: Number(item.price) * Number(item.qty),
    stock_managed: Boolean(item.stockManaged)
  })));
}

function checkoutIntegrityGuard(txn) {
  return txn`
    DO $mititoys$
    DECLARE
      checkout_order_id bigint := current_setting('mititoys.checkout_order_id')::bigint;
      expected_items jsonb := current_setting('mititoys.checkout_expected_items')::jsonb;
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.id=checkout_order_id
          AND (
            SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id
          )=jsonb_array_length(expected_items)
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(expected_items) expected
            WHERE NOT EXISTS (
              SELECT 1
              FROM order_items oi
              WHERE oi.order_id=o.id
                AND oi.product_id=expected->>'product_id'
                AND oi.quantity=(expected->>'quantity')::integer
                AND ABS(oi.unit_price-(expected->>'unit_price')::numeric)<0.01
                AND ABS(oi.total_amount-(expected->>'total_amount')::numeric)<0.01
            )
          )
          AND ABS(
            COALESCE((SELECT SUM(oi.total_amount) FROM order_items oi WHERE oi.order_id=o.id),-1)
            - COALESCE(o.subtotal_amount,-1)
          )<0.01
          AND (
            o.shipping_quote_id IS NULL
            OR EXISTS (
              SELECT 1 FROM shipping_quotes q
              WHERE q.id=o.shipping_quote_id AND q.order_id=o.id AND q.used_at IS NOT NULL
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(expected_items) expected
            WHERE COALESCE((expected->>'stock_managed')::boolean,false)
              AND NOT EXISTS (
                SELECT 1
                FROM inventory_movements m
                WHERE m.order_id=o.id
                  AND m.product_id=expected->>'product_id'
                  AND m.movement_type='reserve'
                  AND m.quantity=-(expected->>'quantity')::integer
              )
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CHECKOUT_LOCAL_INTEGRITY_FAILED';
      END IF;
    END
    $mititoys$
  `;
}

async function persistCheckoutLocal(sql, {
  orderId,
  customerId,
  items,
  subtotal,
  shippingAmount,
  total,
  shippingQuoteId,
  shipping,
  customer,
  provinceName,
  finalPostalCode,
  street,
  streetNumber,
  floor,
  unit,
  deliveryAddress,
  deliveryCity,
  summary
}) {
  if (!Number.isInteger(Number(orderId)) || Number(orderId) < 1 || !Array.isArray(items) || !items.length) {
    throw Object.assign(new Error('Datos locales del checkout inválidos.'), { code: 'CHECKOUT_LOCAL_INPUT_INVALID' });
  }

  const externalReference = `MITITOYS-ORDER-${orderId}`;
  const first = items[0];
  const units = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const expectedJson = expectedItemsJson(items);
  const cleanValue = (value, max = 200) => String(value || '').trim().slice(0, max);

  let transactionResults;
  try {
    transactionResults = await sql.transaction((txn) => {
      const queries = [
        txn`
          SELECT
            set_config('mititoys.checkout_order_id',${String(orderId)},true),
            set_config('mititoys.checkout_expected_items',${expectedJson},true)
        `,
        txn`
          INSERT INTO orders(
            id,order_number,customer_id,product_id,product_title,quantity,unit_price,
            subtotal_amount,shipping_amount,total_amount,external_reference,
            shipping_recipient,shipping_address,shipping_city,shipping_postal_code,
            shipping_province,shipping_phone,shipping_notes,shipping_provider,
            shipping_carrier_id,shipping_carrier,shipping_service,
            shipping_estimated_hours,shipping_quote_id,shipping_destination_type,
            shipping_locality_id,shipping_street,shipping_number,shipping_floor,shipping_unit,
            shipping_branch_id,shipping_branch_name,shipping_branch_address
          ) VALUES(
            ${orderId},'MT-'||TO_CHAR(NOW(),'YYYYMMDDHH24MISSMS')||'-'||SUBSTRING(MD5(RANDOM()::text),1,6),
            ${customerId},${first.id},${summary},${units},${first.price},
            ${subtotal},${shippingAmount},${total},${externalReference},
            ${cleanValue(customer.name,160) || 'Cliente'},${deliveryAddress || null},${deliveryCity || null},${finalPostalCode},
            ${provinceName},${cleanValue(customer.phone,50) || null},${cleanValue(customer.notes,1000) || null},${shipping?.provider || null},
            ${shipping?.carrier_id || null},${shipping?.carrier_name || null},${shipping?.service_name || null},
            ${shipping?.estimated_hours || null},${shippingQuoteId || null},${shipping?.destination_type || 'home'},
            ${shipping?.destination_locality_id || null},${street || null},${streetNumber || null},${floor || null},${unit || null},
            ${shipping?.branch_id || null},${shipping?.branch_name || null},${shipping?.branch_address || null}
          ) RETURNING id,order_number
        `
      ];

      if (shippingQuoteId) {
        queries.push(txn`
          UPDATE shipping_quotes SET used_at=NOW(),order_id=${orderId}
          WHERE id=${shippingQuoteId} AND used_at IS NULL AND expires_at>NOW()
          RETURNING id
        `);
      }

      for (const item of items) {
        queries.push(txn`
          INSERT INTO order_items(order_id,product_id,product_title,quantity,unit_price,total_amount)
          VALUES(${orderId},${item.id},${item.title},${item.qty},${item.price},${item.price * item.qty})
        `);
      }

      for (const item of items) {
        if (!item.stockManaged) continue;
        const reservationQuery = reserveStockQuery(txn, {
          productId: item.id,
          orderId,
          quantity: item.qty
        });
        if (!reservationQuery) {
          throw Object.assign(new Error('Reserva de stock inválida.'), { code: 'CHECKOUT_LOCAL_INPUT_INVALID' });
        }
        queries.push(reservationQuery);
      }

      queries.push(checkoutIntegrityGuard(txn));
      return queries;
    }, { isolationMode: 'Serializable' });
  } catch (error) {
    if (error?.message === 'CHECKOUT_LOCAL_INTEGRITY_FAILED' || error?.code === 'P0001') {
      throw Object.assign(new Error('No se pudo confirmar stock o integridad local del pedido.'), { code: 'CHECKOUT_LOCAL_INTEGRITY_FAILED' });
    }
    throw error;
  }

  const orderRows = transactionResults?.[1] || [];
  const order = orderRows[0];
  if (!order?.id || !order?.order_number) {
    throw Object.assign(new Error('La transacción local no devolvió el pedido creado.'), { code: 'CHECKOUT_LOCAL_INTEGRITY_FAILED' });
  }

  return {
    orderId: Number(order.id),
    orderNumber: String(order.order_number),
    externalReference,
    reserved: items.filter(item => item.stockManaged)
  };
}

async function cleanupCheckoutLocal(sql, {
  orderId,
  reason = 'Liberación por error al crear el pago'
}) {
  if (!Number.isInteger(Number(orderId)) || Number(orderId) < 1) {
    return { cleaned: false, releasedUnits: 0, releasedQuotes: 0 };
  }

  const rows = await sql`
    WITH claimed_order AS (
      UPDATE orders
      SET status='cancelled',updated_at=NOW()
      WHERE id=${orderId}
        AND status='pending'
        AND payment_id IS NULL
        AND COALESCE(payment_status,'pending')='pending'
        AND preference_id IS NULL
        AND payment_url IS NULL
      RETURNING id
    ), inserted_release AS (
      INSERT INTO inventory_movements(product_id,order_id,movement_type,quantity,reason)
      SELECT m.product_id,m.order_id,'release',ABS(m.quantity),${reason}
      FROM inventory_movements m
      JOIN claimed_order c ON c.id=m.order_id
      WHERE m.movement_type='reserve' AND m.quantity<0
      ON CONFLICT (order_id,product_id,movement_type)
        WHERE order_id IS NOT NULL AND movement_type='release'
      DO NOTHING
      RETURNING product_id,quantity
    ), released_products AS (
      UPDATE products p
      SET stock_quantity=p.stock_quantity+r.quantity,updated_at=NOW()
      FROM (
        SELECT product_id,SUM(quantity)::int AS quantity
        FROM inserted_release
        GROUP BY product_id
      ) r
      WHERE p.id=r.product_id
      RETURNING p.id,r.quantity
    ), released_quotes AS (
      UPDATE shipping_quotes
      SET used_at=NULL,order_id=NULL
      WHERE order_id IN (SELECT id FROM claimed_order)
      RETURNING id
    ), cleanup_event AS (
      INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)
      SELECT c.id,'checkout.local_cleanup','pending','cancelled',jsonb_build_object(
        'reason',${reason},
        'stock_released',COALESCE((SELECT SUM(quantity) FROM released_products),0),
        'quotes_released',(SELECT COUNT(*) FROM released_quotes)
      )
      FROM claimed_order c
      RETURNING id
    )
    SELECT
      EXISTS(SELECT 1 FROM claimed_order) AS cleaned,
      COALESCE((SELECT SUM(quantity) FROM released_products),0)::int AS released_units,
      (SELECT COUNT(*) FROM released_quotes)::int AS released_quotes,
      EXISTS(SELECT 1 FROM cleanup_event) AS event_recorded
  `;

  const result = rows[0] || {};
  return {
    cleaned: Boolean(result.cleaned),
    releasedUnits: Number(result.released_units || 0),
    releasedQuotes: Number(result.released_quotes || 0),
    eventRecorded: Boolean(result.event_recorded)
  };
}

module.exports = {
  allocateOrderId,
  expectedItemsJson,
  checkoutIntegrityGuard,
  persistCheckoutLocal,
  cleanupCheckoutLocal
};
