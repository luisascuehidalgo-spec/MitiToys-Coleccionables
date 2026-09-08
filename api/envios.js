const crypto = require('crypto');
const { getDb } = require('../lib/db');
const { searchParams } = require('../lib/request-url');
const { releaseReservedStock } = require('../lib/inventory');
const { orderStatusFromShipping, shippingStatusFromProvider } = require('../lib/order-state');
const { findPaymentsByExternalReference, findPreferenceByExternalReference, PREFERENCE_TTL_MS } = require('../lib/payments');
const {
  shippingEnabled, normalizePostalCode, normalizeProvinceCode, normalizeCart, cartHash,
  buildPackages, quoteEnviopack, listLocalities, quoteEnviopackBranch,
  getShipment, getShipmentTracking
} = require('../lib/shipping');
const {
  emailEnabled, queueAndSendOrderNotification, queueOrderNotification,
  deliverPendingNotifications, ensureReviewInvites
} = require('../lib/notifications');

function shipmentState(details, tracking) {
  const last = String(tracking.at(-1)?.mensaje || details?.condicion?.nombre || details?.condicion || '').toLowerCase();
  if (/entreg/.test(last)) return { shipping: 'delivered', order: 'delivered' };
  if (/rechaz|siniestr|devuel|cancel|no entreg/.test(last)) return { shipping: 'exception', order: 'processing' };
  if (tracking.length || /tránsito|transito|distribuci|despach|sucursal/.test(last)) return { shipping: 'in_transit', order: 'shipped' };
  return { shipping: 'preparing', order: 'processing' };
}

async function syncProviderShipment(sql, shipmentId, loadTracking = true) {
  const orders = await sql`SELECT id,tracking_number,status,payment_status,shipping_status FROM orders WHERE enviopack_shipment_id=${String(shipmentId)} LIMIT 1`;
  if (!orders.length) return null;
  const details = await getShipment(shipmentId);
  let tracking = [];
  if (loadTracking && String(details?.estado || '').toUpperCase() === 'P') {
    try { tracking = await getShipmentTracking(shipmentId); } catch (error) { console.warn('tracking unavailable:', 'code=' + String(error?.code || 'unknown'), 'status=' + String(error?.providerStatus || 'unknown')); }
  }
  const trackingNumber = String(details?.tracking_number || details?.numero_tracking || orders[0].tracking_number || '').trim() || null;
  const state = shipmentState(details, tracking);
  state.order = orderStatusFromShipping(orders[0], state.order);
  state.shipping = shippingStatusFromProvider(orders[0].shipping_status, state.shipping);
  const labelReady = String(details?.estado || '').toUpperCase() === 'P';
  await sql`
    UPDATE orders SET
      enviopack_state=${String(details?.estado || '') || null},
      tracking_number=${trackingNumber},
      shipping_label_ready=${labelReady},
      shipping_status=${state.shipping},
      status=${state.order},
      shipping_last_synced_at=NOW(),
      shipping_last_error=NULL,
      updated_at=NOW()
    WHERE id=${orders[0].id}
  `;
  await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${orders[0].id},'enviopack.synced',${orders[0].status},${state.order},${JSON.stringify({ shipment_id: String(shipmentId), provider_state: details?.estado || null, tracking_number: trackingNumber, tracking })}::jsonb)`;
  if (trackingNumber && trackingNumber !== orders[0].tracking_number && orders[0].payment_status === 'approved') await queueAndSendOrderNotification(sql, orders[0].id, 'shipment_created');
  if (state.order === 'delivered') {
    await ensureReviewInvites(sql, orders[0].id);
    await queueAndSendOrderNotification(sql, orders[0].id, 'review_invite');
  }
  return { details, tracking, trackingNumber, state, labelReady };
}

async function runAutomation(sql) {
  const uncertainPreferences = await sql`
    SELECT id,external_reference,shipping_quote_id,created_at FROM orders
    WHERE status='pending' AND COALESCE(payment_status,'pending')='pending'
      AND payment_id IS NULL AND payment_url IS NULL AND preference_id IS NULL
      AND created_at < NOW()-INTERVAL '5 minutes'
    ORDER BY created_at LIMIT 25
  `;
  let preferencesRecovered = 0;
  let uncertainCancelled = 0;
  let preferenceChecksFailed = 0;
  let uncertainStockReleased = 0;

  for (const order of uncertainPreferences) {
    const ageMs = Date.now() - new Date(order.created_at).getTime();
    let preference = null;
    if (ageMs < PREFERENCE_TTL_MS) {
      try {
        preference = await findPreferenceByExternalReference(order.external_reference);
      } catch (error) {
        preferenceChecksFailed += 1;
        console.warn('Mercado Pago preference reconciliation failed:', 'code=' + String(error?.code || 'MP_PREFERENCE_SEARCH_FAILED'), 'status=' + String(error?.providerStatus || 'unknown'));
        continue;
      }
    }

    if (preference) {
      const recovered = await sql`
        UPDATE orders SET preference_id=${preference.id},payment_url=${preference.init_point},payment_status_detail=NULL,updated_at=NOW()
        WHERE id=${order.id} AND status='pending' AND payment_id IS NULL AND payment_url IS NULL
        RETURNING id
      `;
      if (recovered.length) {
        await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${order.id},'payment.preference_recovered','pending',${JSON.stringify({ preference_id: preference.id })}::jsonb)`;
        preferencesRecovered += 1;
      }
      continue;
    }

    if (ageMs < 2 * 60 * 60 * 1000) continue;

    let payments;
    try {
      payments = await findPaymentsByExternalReference(order.external_reference);
    } catch (error) {
      preferenceChecksFailed += 1;
      console.warn('Mercado Pago uncertain checkout payment check failed:', 'code=' + String(error?.code || 'MP_PAYMENT_SEARCH_FAILED'), 'status=' + String(error?.providerStatus || 'unknown'));
      continue;
    }
    if (payments.length) continue;

    const claimed = await sql`
      UPDATE orders SET status='cancelled',payment_status='expired',payment_status_detail='preference_not_found',updated_at=NOW()
      WHERE id=${order.id} AND status='pending' AND payment_id IS NULL AND payment_url IS NULL
        AND COALESCE(payment_status,'pending')='pending'
      RETURNING id
    `;
    if (!claimed.length) continue;

    const released = await releaseReservedStock(sql, order.id, 'Liberación por preferencia de pago no confirmada');
    uncertainStockReleased += released.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    if (order.shipping_quote_id) {
      await sql`UPDATE shipping_quotes SET used_at=NULL,order_id=NULL WHERE id=${order.shipping_quote_id} AND order_id=${order.id}`;
    }
    await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${order.id},'payment.preference_expired','pending','cancelled',${JSON.stringify({ stock_released: released })}::jsonb)`;
    uncertainCancelled += 1;
  }

  const abandoned = await sql`
    SELECT id FROM orders
    WHERE status='pending' AND COALESCE(payment_status,'pending')='pending' AND payment_url IS NOT NULL
      AND created_at < NOW()-INTERVAL '2 hours' AND created_at > NOW()-INTERVAL '24 hours'
    ORDER BY created_at LIMIT 25
  `;
  for (const order of abandoned) await queueOrderNotification(sql, order.id, 'abandoned_checkout');

  const expired = await sql`
    SELECT id,external_reference FROM orders
    WHERE status='pending' AND COALESCE(payment_status,'pending')='pending'
      AND payment_id IS NULL AND payment_url IS NOT NULL
      AND created_at < NOW()-INTERVAL '26 hours'
    ORDER BY created_at LIMIT 25
  `;
  let expiredCancelled = 0;
  let providerPaymentsFound = 0;
  let providerChecksFailed = 0;
  let stockUnitsReleased = 0;

  for (const order of expired) {
    let payments;
    try {
      payments = await findPaymentsByExternalReference(order.external_reference);
    } catch (error) {
      providerChecksFailed += 1;
      console.warn('Mercado Pago cleanup check failed:', 'code=' + String(error?.code || 'MP_PAYMENT_SEARCH_FAILED'), 'status=' + String(error?.providerStatus || 'unknown'));
      continue;
    }
    if (payments.length) {
      providerPaymentsFound += 1;
      continue;
    }

    const claimed = await sql`
      UPDATE orders SET status='cancelled',payment_status='expired',updated_at=NOW()
      WHERE id=${order.id} AND status='pending' AND payment_id IS NULL
        AND COALESCE(payment_status,'pending')='pending'
      RETURNING id
    `;
    if (!claimed.length) continue;

    const released = await releaseReservedStock(sql, order.id, 'Liberación por checkout vencido');
    stockUnitsReleased += released.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${order.id},'checkout.expired','pending','cancelled',${JSON.stringify({ stock_released: released })}::jsonb)`;
    expiredCancelled += 1;
  }

  const delivered = await sql`SELECT id FROM orders WHERE status='delivered' ORDER BY updated_at DESC LIMIT 25`;
  for (const order of delivered) {
    await ensureReviewInvites(sql, order.id);
    await queueOrderNotification(sql, order.id, 'review_invite');
  }
  const deliveredNotifications = await deliverPendingNotifications(sql, 20);
  return {
    preferences_recovered: preferencesRecovered,
    uncertain_cancelled: uncertainCancelled,
    preference_checks_failed: preferenceChecksFailed,
    uncertain_stock_units_released: uncertainStockReleased,
    abandoned_queued: abandoned.length,
    expired_cancelled: expiredCancelled,
    provider_payments_found: providerPaymentsFound,
    provider_checks_failed: providerChecksFailed,
    stock_units_released: stockUnitsReleased,
    delivered_review_checked: delivered.length,
    notifications_processed: deliveredNotifications.length
  };
}

module.exports = async (req, res) => {
  const query = searchParams(req);
  const sql = getDb();
  try {
    if (req.method === 'GET') {
      const webhookType = String(query.get('tipo') || '');
      const webhookId = String(query.get('id') || '');
      if (webhookId && ['envio-procesado', 'envio-cambio-condicion'].includes(webhookType)) {
        try { await syncProviderShipment(sql, webhookId, true); } catch (error) { console.error('Enviopack webhook sync failed:', 'code=' + String(error?.code || 'unknown'), 'status=' + String(error?.providerStatus || 'unknown')); }
        return res.status(200).json({ received: true });
      }

      if (query.get('action') === 'localities') {
        const provinceCode = normalizeProvinceCode(query.get('province'));
        if (!provinceCode) return res.status(400).json({ error: 'Provincia inválida.' });
        const localities = await listLocalities(provinceCode);
        res.setHeader('Cache-Control', 'private, max-age=1800');
        return res.status(200).json({ localities });
      }

      if (query.get('action') === 'automation') {
        if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'No autorizado.' });
        return res.status(200).json({ ok: true, ...(await runAutomation(sql)) });
      }

      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.status(200).json({
        enabled: shippingEnabled(),
        provider: shippingEnabled() ? 'Envíopack' : null,
        modes: ['home', 'branch'],
        email_enabled: emailEnabled()
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
    if (!shippingEnabled()) return res.status(503).json({ code: 'SHIPPING_NOT_CONFIGURED', error: 'La cotización automática todavía no está habilitada.' });

    const items = normalizeCart(req.body?.items);
    const provinceCode = normalizeProvinceCode(req.body?.province_code);
    const deliveryType = req.body?.delivery_type === 'branch' ? 'branch' : 'home';
    const postalCode = normalizePostalCode(req.body?.postal_code);
    const localityId = String(req.body?.locality_id || '').trim();
    if (!items.length) return res.status(400).json({ error: 'El carrito está vacío.' });
    if (!provinceCode) return res.status(400).json({ error: 'Seleccioná la provincia de destino.' });
    if (deliveryType === 'home' && !postalCode) return res.status(400).json({ error: 'Ingresá un código postal argentino de 4 dígitos.' });
    if (deliveryType === 'branch' && !localityId) return res.status(400).json({ error: 'Seleccioná una localidad para ver sucursales.' });

    const products = [];
    for (const item of items) {
      const rows = await sql`SELECT id,title,active,weight_kg,package_length_cm,package_width_cm,package_height_cm FROM products WHERE id=${item.id} LIMIT 1`;
      if (!rows.length || rows[0].active === false) return res.status(409).json({ error: `El producto COD ${item.id} ya no está disponible.` });
      products.push(rows[0]);
    }
    const { packages, missing } = buildPackages(products, items);
    if (missing.length) return res.status(422).json({ code: 'PRODUCT_SHIPPING_DATA_MISSING', error: 'Faltan peso o medidas de envío en uno o más productos.', products: missing });

    const rates = deliveryType === 'branch'
      ? await quoteEnviopackBranch({ provinceCode, localityId, packages })
      : await quoteEnviopack({ provinceCode, postalCode, packages });
    const fingerprint = cartHash(items);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const options = [];
    for (const rate of rates) {
      const id = crypto.randomUUID();
      const branch = rate.branch || null;
      const destinationPostal = deliveryType === 'branch' ? (branch?.postalCode || '0000') : postalCode;
      await sql`
        INSERT INTO shipping_quotes(
          id,provider,cart_hash,destination_postal_code,destination_province,carrier_id,carrier_name,
          service_code,service_name,dispatch_mode,amount,currency,estimated_hours,package_details,expires_at,
          destination_type,destination_locality_id,destination_locality_name,branch_id,branch_name,branch_address,branch_schedule
        ) VALUES(
          ${id},'enviopack',${fingerprint},${destinationPostal},${provinceCode},${rate.carrierId},${rate.carrierName},
          ${rate.serviceCode},${rate.serviceName},${rate.dispatchMode || null},${rate.amount},'ARS',${rate.estimatedHours},${JSON.stringify(packages)}::jsonb,${expiresAt.toISOString()},
          ${deliveryType},${branch?.localityId || (deliveryType === 'branch' ? localityId : null)},${branch?.localityName || null},
          ${branch?.id || null},${branch?.name || null},${branch?.address || null},${branch?.schedule || null}
        )
      `;
      options.push({
        quote_id: id, delivery_type: deliveryType, carrier_id: rate.carrierId, carrier_name: rate.carrierName,
        service_code: rate.serviceCode, service_name: rate.serviceName, amount: rate.amount, currency: 'ARS',
        estimated_hours: rate.estimatedHours,
        estimated_days: rate.estimatedHours ? Math.max(1, Math.ceil(rate.estimatedHours / 24)) : null,
        branch: branch ? { id: branch.id, name: branch.name, address: branch.address, postal_code: branch.postalCode, schedule: branch.schedule, locality_name: branch.localityName } : null,
        recommended: options.length === 0
      });
    }
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({ delivery_type: deliveryType, province_code: provinceCode, expires_at: expiresAt.toISOString(), options });
  } catch (error) {
    console.error('envios error:', 'code=' + String(error?.code || 'SHIPPING_ERROR'), 'status=' + String(error?.providerStatus || error?.status || 'unknown'));
    const status = error?.code === 'NO_SHIPPING_RATES' ? 404 : error?.code === 'DESTINATION_MISMATCH' ? 400 : error?.code === 'SHIPPING_NOT_CONFIGURED' ? 503 : 502;
    return res.status(status).json({ code: error?.code || 'SHIPPING_ERROR', error: error?.message || 'No se pudo procesar el envío.' });
  }
};
