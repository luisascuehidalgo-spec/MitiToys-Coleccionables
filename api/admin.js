const { getDb } = require('../lib/db');
const { verify } = require('./admin-auth');
const { searchParams } = require('../lib/request-url');
const { releaseReservedStockIfUnshipped } = require('../lib/inventory');
const { expirePreference } = require('../lib/payments');
const { adminStatusError, orderStatusFromShipping, shippingStatusFromProvider, requiresPaymentReview } = require('../lib/order-state');
const { persistShippingObservation, persistCreatedShipment } = require('../lib/shipping-sync');
const { shipmentOwner, shipmentConflictOwner } = require('../lib/external-identities');
const {
  buildPackages, getOrCreateEnviopackOrder, createConfirmedShipment,
  getShipment, getShipmentTracking, getShipmentLabel, listEnviopackOrderShipments
} = require('../lib/shipping');
const { queueAndSendOrderNotification, ensureReviewInvites } = require('../lib/notifications');

const VALID = new Set(['pending','approved','processing','shipped','delivered','cancelled','refunded']);
const clean = (value, max = 200) => String(value || '').trim().slice(0, max);

function parseAddress(order) {
  if (order.shipping_street && order.shipping_number) return { street: order.shipping_street, number: order.shipping_number };
  const raw = clean(order.shipping_address, 220);
  const match = raw.match(/^(.+?)[,\s]+(\d{1,5})(?:\D.*)?$/);
  return match ? { street: match[1].trim(), number: match[2] } : { street: '', number: '' };
}

function providerState(details, tracking) {
  const last = String(tracking.at(-1)?.mensaje || details?.condicion?.nombre || details?.condicion || '').toLowerCase();
  if (/entreg/.test(last)) return { shipping: 'delivered', order: 'delivered' };
  if (/rechaz|siniestr|devuel|cancel|no entreg/.test(last)) return { shipping: 'exception', order: 'processing' };
  if (tracking.length || /tránsito|transito|distribuci|despach|sucursal/.test(last)) return { shipping: 'in_transit', order: 'shipped' };
  return { shipping: 'preparing', order: 'processing' };
}

async function loadFulfillmentOrder(sql, id) {
  const rows = await sql`
    SELECT o.*,c.name AS customer_name,c.email AS customer_email,c.phone AS customer_phone,
      q.destination_province AS shipping_province_code,q.service_code,q.dispatch_mode,q.package_details,
      q.destination_type,q.destination_locality_id,q.destination_locality_name,
      q.branch_id AS quote_branch_id,q.branch_name AS quote_branch_name,q.branch_address AS quote_branch_address
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
    LEFT JOIN shipping_quotes q ON q.id=o.shipping_quote_id
    WHERE o.id=${id} LIMIT 1
  `;
  return rows[0] || null;
}

async function packagesForOrder(sql, order) {
  if (Array.isArray(order.package_details) && order.package_details.length) return order.package_details;
  const items = await sql`SELECT product_id AS id,quantity AS qty FROM order_items WHERE order_id=${order.id}`;
  const products = [];
  for (const item of items) {
    const rows = await sql`SELECT id,title,weight_kg,package_length_cm,package_width_cm,package_height_cm FROM products WHERE id=${item.id} LIMIT 1`;
    if (rows[0]) products.push(rows[0]);
  }
  const built = buildPackages(products, items);
  if (built.missing.length) throw Object.assign(new Error('Completá peso y medidas de todos los productos antes de generar el envío.'), { code: 'PRODUCT_SHIPPING_DATA_MISSING' });
  return built.packages;
}

async function createShipment(sql, id) {
  let providerShipment = null;
  let providerOrderId = null;
  let providerShipmentsBefore = [];
  let reusedProviderShipment = false;
  let order = await loadFulfillmentOrder(sql, id);
  if (!order) throw Object.assign(new Error('Pedido no encontrado.'), { status: 404 });
  if (order.enviopack_shipment_id) return { reused: true, order };
  if (order.payment_status !== 'approved') throw Object.assign(new Error('El envío solo puede generarse cuando Mercado Pago confirma el pago.'), { status: 409 });
  if (requiresPaymentReview(order)) throw Object.assign(new Error('El pago requiere revisión manual en Mercado Pago antes de generar el envío.'), { status: 409, code: 'PAYMENT_REQUIRES_REVIEW' });
  if (!order.shipping_quote_id || order.shipping_provider !== 'enviopack') throw Object.assign(new Error('Este pedido no tiene una cotización de Envíopack asociada.'), { status: 409 });

  const claim = await sql`
    UPDATE orders SET shipping_generation_status='processing',shipping_last_error=NULL,updated_at=NOW()
    WHERE id=${id} AND payment_status='approved'
      AND COALESCE(payment_status_detail,'') NOT IN ('multiple_approved_conflict','partially_refunded')
      AND status NOT IN ('cancelled','refunded') AND enviopack_shipment_id IS NULL AND shipping_generation_status IN ('not_created','failed')
    RETURNING id
  `;
  if (!claim.length) throw Object.assign(new Error('El envío ya se está generando, el pago dejó de estar aprobado o requiere revisión. Actualizá el panel antes de reintentar.'), { status: 409 });

  try {
    const address = parseAddress(order);
    order = {
      ...order,
      shipping_destination_type: order.destination_type || order.shipping_destination_type || 'home',
      shipping_street: order.shipping_street || address.street,
      shipping_number: order.shipping_number || address.number,
      shipping_branch_id: order.shipping_branch_id || order.quote_branch_id,
      shipping_branch_name: order.shipping_branch_name || order.quote_branch_name,
      shipping_branch_address: order.shipping_branch_address || order.quote_branch_address
    };
    if (order.shipping_destination_type === 'branch' && !order.shipping_branch_id) throw new Error('Falta seleccionar la sucursal de destino.');
    if (order.shipping_destination_type !== 'branch' && (!order.shipping_street || !order.shipping_number || !order.shipping_postal_code || !order.shipping_city)) {
      throw new Error('Faltan calle, número, localidad o código postal en el pedido.');
    }

    const items = await sql`SELECT product_id,product_title,quantity FROM order_items WHERE order_id=${id} ORDER BY id`;
    const packages = await packagesForOrder(sql, order);
    const firstPaymentGuard = await sql`SELECT status,payment_status,payment_status_detail FROM orders WHERE id=${id} LIMIT 1`;
    if (!firstPaymentGuard.length || firstPaymentGuard[0].payment_status !== 'approved' || requiresPaymentReview(firstPaymentGuard[0]) || ['cancelled','refunded'].includes(String(firstPaymentGuard[0].status || ''))) {
      throw Object.assign(new Error('Mercado Pago cambió el estado del pago antes de iniciar el despacho.'), { status: 409, code: 'PAYMENT_CHANGED_DURING_SHIPMENT' });
    }
    providerOrderId = order.enviopack_order_id || await getOrCreateEnviopackOrder({
      order,
      customer: { name: order.customer_name, email: order.customer_email, phone: order.customer_phone },
      items
    });
    await sql`UPDATE orders SET enviopack_order_id=${providerOrderId},updated_at=NOW() WHERE id=${id}`;
    const secondPaymentGuard = await sql`SELECT status,payment_status,payment_status_detail FROM orders WHERE id=${id} LIMIT 1`;
    if (!secondPaymentGuard.length || secondPaymentGuard[0].payment_status !== 'approved' || requiresPaymentReview(secondPaymentGuard[0]) || ['cancelled','refunded'].includes(String(secondPaymentGuard[0].status || ''))) {
      throw Object.assign(new Error('Mercado Pago cambió el estado del pago antes de confirmar el despacho.'), { status: 409, code: 'PAYMENT_CHANGED_DURING_SHIPMENT' });
    }

    providerShipmentsBefore = await listEnviopackOrderShipments(providerOrderId);
    if (providerShipmentsBefore.length > 1) {
      await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('Envíopack ya tiene múltiples envíos asociados a este pedido. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id}`;
      await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.multiple_shipments_detected',${order.status},${JSON.stringify({ provider_order_id: providerOrderId, shipment_ids: providerShipmentsBefore.map(item => item.id) })}::jsonb)`;
      throw Object.assign(new Error('Envíopack ya tiene múltiples envíos asociados a este pedido. No generes otro hasta revisarlos.'), { status: 409, code: 'SHIPMENT_PROVIDER_MULTIPLE_MATCHES' });
    }

    let shipment;
    if (providerShipmentsBefore.length === 1) {
      shipment = providerShipmentsBefore[0];
      try { shipment = await getShipment(providerShipmentsBefore[0].id); }
      catch (detailsError) { console.warn('existing shipment details unavailable:', 'code=' + String(detailsError?.code || detailsError?.name || 'DETAILS_ERROR'), 'status=' + String(detailsError?.providerStatus || 'unknown')); }
      reusedProviderShipment = true;
    } else {
      const finalPaymentGuard = await sql`SELECT status,payment_status,payment_status_detail FROM orders WHERE id=${id} LIMIT 1`;
      if (!finalPaymentGuard.length || finalPaymentGuard[0].payment_status !== 'approved' || requiresPaymentReview(finalPaymentGuard[0]) || ['cancelled','refunded'].includes(String(finalPaymentGuard[0].status || ''))) {
        throw Object.assign(new Error('Mercado Pago cambió el estado del pago antes de crear el envío.'), { status: 409, code: 'PAYMENT_CHANGED_DURING_SHIPMENT' });
      }
      shipment = await createConfirmedShipment({
        providerOrderId,
        order,
        packages,
        quote: { service_code: order.service_code, carrier_id: order.shipping_carrier_id, dispatch_mode: order.dispatch_mode }
      });
    }
    providerShipment = shipment;
    if (!shipment?.id) throw Object.assign(new Error('Envíopack devolvió una respuesta de envío inválida.'), { status: 502, code: 'INVALID_SHIPMENT_RESPONSE' });
    const shipmentId = String(shipment.id);
    const existingShipmentOwner = await shipmentOwner(sql, shipmentId, id);
    if (existingShipmentOwner) {
      await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('Envíopack devolvió un shipment_id que ya pertenece a otro pedido. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id}`;
      await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_ownership_conflict',${order.status},${JSON.stringify({ shipment_id: shipmentId, conflict_order_id: existingShipmentOwner })}::jsonb)`;
      throw Object.assign(new Error('Envíopack devolvió un identificador de envío ya asociado a otro pedido. No vuelvas a generar el envío hasta revisarlo.'), { status: 409, code: 'SHIPMENT_OWNERSHIP_CONFLICT' });
    }
    const providerShipmentState = String(shipment.estado || '');
    const trackingNumber = clean(shipment.tracking_number || shipment.numero_tracking, 120) || null;
    const labelReady = providerShipmentState.toUpperCase() === 'P';
    const persisted = await persistCreatedShipment(sql, {
      orderId: id,
      shipmentId,
      providerState: providerShipmentState,
      trackingNumber,
      labelReady,
      destination: {
        type: order.shipping_destination_type,
        street: order.shipping_street || null,
        number: order.shipping_number || null,
        branchId: order.shipping_branch_id || null,
        branchName: order.shipping_branch_name || null,
        branchAddress: order.shipping_branch_address || null
      }
    });
    if (!persisted.ok) {
      if (['identity_conflict','generation_conflict'].includes(persisted.reason)) {
        throw Object.assign(new Error('El pedido ya tiene otra identidad logística o quedó en conflicto. No generes otro envío.'), { status: 409, code: 'SHIPMENT_LOCAL_IDENTITY_CONFLICT' });
      }
      throw Object.assign(new Error('El envío fue creado en Envíopack, pero el pedido cambió mientras se confirmaba localmente.'), { status: 502, code: 'SHIPMENT_CREATED_PERSISTENCE_RACE' });
    }
    await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_created',${persisted.order.status},${JSON.stringify({ provider_order_id: providerOrderId, shipment_id: shipmentId, provider_state: providerShipmentState, tracking_number: trackingNumber })}::jsonb)`;
    if (trackingNumber && persisted.order.payment_status === 'approved' && !requiresPaymentReview(persisted.order)) await queueAndSendOrderNotification(sql, id, 'shipment_created');
    return { reused: reusedProviderShipment, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady, order_status: persisted.order.status };
  } catch (error) {
    if (['SHIPMENT_OWNERSHIP_CONFLICT','SHIPMENT_PROVIDER_MULTIPLE_MATCHES','SHIPMENT_LOCAL_IDENTITY_CONFLICT'].includes(error?.code)) throw error;
    if (error?.code === 'SHIPPING_PROVIDER_UNCERTAIN' && providerOrderId) {
      let discoveredShipments = [];
      try {
        discoveredShipments = await listEnviopackOrderShipments(providerOrderId);
      } catch (reconcileError) {
        console.warn('shipment uncertainty reconciliation failed:', 'code=' + String(reconcileError?.code || reconcileError?.name || 'RECONCILE_ERROR'));
      }
      const beforeIds = new Set(providerShipmentsBefore.map(item => String(item.id)));
      const newShipments = discoveredShipments.filter(item => !beforeIds.has(String(item.id)));
      if (discoveredShipments.length > 1 || newShipments.length > 1) {
        await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('El resultado del alta fue incierto y Envíopack informa múltiples envíos asociados. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id}`;
        await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.multiple_shipments_detected',${order.status},${JSON.stringify({ provider_order_id: providerOrderId, shipment_ids: discoveredShipments.map(item => item.id), source: 'timeout_reconciliation' })}::jsonb)`;
        throw Object.assign(new Error('Envíopack informa múltiples envíos para este pedido. No generes otro hasta revisarlos.'), { status: 409, code: 'SHIPMENT_PROVIDER_MULTIPLE_MATCHES' });
      }
      if (newShipments.length === 1) {
        return reconcileShipmentCreation(sql, id);
      }
      if (!providerShipment) {
        await sql`UPDATE orders SET shipping_generation_status='uncertain',shipping_last_error=${clean('No se pudo confirmar si Envíopack creó el envío. No generes otro: usá Verificar en Envíopack.',1000)},updated_at=NOW() WHERE id=${id}`;
        await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_creation_uncertain',${order.status},${JSON.stringify({ provider_order_id: providerOrderId })}::jsonb)`;
        throw Object.assign(new Error('No se pudo confirmar si Envíopack creó el envío. No lo vuelvas a generar; usá Verificar en Envíopack.'), { status: 409, code: 'SHIPMENT_CREATION_UNCERTAIN' });
      }
    }
    if (providerShipment?.id) {
      const recoveredShipmentId = String(providerShipment.id);
      const conflictOwner = await shipmentConflictOwner(sql, error, recoveredShipmentId, id);
      if (conflictOwner) {
        await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('Conflicto de ownership del shipment_id detectado por PostgreSQL. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id}`;
        await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_ownership_conflict',${order.status},${JSON.stringify({ shipment_id: recoveredShipmentId, conflict_order_id: conflictOwner, source: 'unique_constraint' })}::jsonb)`;
        throw Object.assign(new Error('El identificador de envío ya está asociado a otro pedido. No vuelvas a generarlo hasta revisarlo.'), { status: 409, code: 'SHIPMENT_OWNERSHIP_CONFLICT' });
      }
      const recoveredProviderState = String(providerShipment.estado || '');
      const recoveryMessage = clean('El envío fue creado en Envíopack, pero una etapa posterior no se completó. Sincronizá el tracking antes de realizar otra acción.', 1000);
      try {
        const recovery = await persistCreatedShipment(sql, {
          orderId: id,
          shipmentId: recoveredShipmentId,
          providerState: recoveredProviderState,
          trackingNumber: clean(providerShipment.tracking_number || providerShipment.numero_tracking, 120) || null,
          labelReady: recoveredProviderState.toUpperCase() === 'P',
          destination: {
            type: order.shipping_destination_type,
            street: order.shipping_street || null,
            number: order.shipping_number || null,
            branchId: order.shipping_branch_id || null,
            branchName: order.shipping_branch_name || null,
            branchAddress: order.shipping_branch_address || null
          },
          lastError: recoveryMessage,
          attempts: 3
        });
        if (!recovery.ok) {
          console.error('shipment created but local recovery failed:', 'code=' + String(recovery.reason || 'PERSIST_RACE'));
        }
      } catch (persistError) {
        console.error('shipment created but local recovery failed:', 'code=' + String(persistError?.code || persistError?.name || 'PERSIST_ERROR'));
      }
      throw Object.assign(new Error('El envío ya fue creado en Envíopack, pero no se pudo completar una etapa local. No vuelvas a generarlo; actualizá el tracking o verificá Envíopack.'), { status: 502, code: 'SHIPMENT_CREATED_SYNC_FAILED' });
    }

    await sql`UPDATE orders SET shipping_generation_status='failed',shipping_last_error=${clean(error.message, 1000)},updated_at=NOW() WHERE id=${id}`;
    if (error?.code === 'PAYMENT_CHANGED_DURING_SHIPMENT') {
      try {
        const paymentRows = await sql`SELECT payment_status FROM orders WHERE id=${id} LIMIT 1`;
        const paymentStatus = String(paymentRows[0]?.payment_status || '');
        if (['cancelled','rejected','refunded','charged_back'].includes(paymentStatus)) {
          const stockRelease = await releaseReservedStockIfUnshipped(sql, id, 'Liberación tras abortar generación de envío por cambio de pago');
          await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.generation_aborted',${orderStatusFromShipping({status:order.status,payment_status:paymentStatus},order.status)},${JSON.stringify({ reason: 'payment_changed', stock_release: stockRelease })}::jsonb)`;
        }
      } catch (releaseError) {
        console.warn('shipment abort stock release failed:', 'code=' + String(releaseError?.code || releaseError?.name || 'RELEASE_ERROR'));
      }
    }
    throw error;
  }
}


async function reconcileShipmentCreation(sql, id) {
  const order = await loadFulfillmentOrder(sql, id);
  if (!order) throw Object.assign(new Error('Pedido no encontrado.'), { status: 404 });
  if (order.enviopack_shipment_id) return { found: true, reused: true, shipment_id: String(order.enviopack_shipment_id) };
  if (!order.enviopack_order_id) throw Object.assign(new Error('El pedido todavía no tiene una orden asociada en Envíopack.'), { status: 409, code: 'ENVIOPACK_ORDER_MISSING' });

  const shipments = await listEnviopackOrderShipments(order.enviopack_order_id);
  if (!shipments.length) {
    await sql`UPDATE orders SET shipping_generation_status='uncertain',shipping_last_error=${clean('Todavía no aparece un envío asociado en Envíopack. No generes otro hasta confirmar el resultado.',1000)},updated_at=NOW() WHERE id=${id}`;
    return { found: false, pending: true };
  }
  if (shipments.length > 1) {
    const marked = await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('Envíopack informa múltiples envíos asociados a este pedido. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id} AND shipping_generation_status IS DISTINCT FROM 'conflict' RETURNING id`;
    if (marked.length) await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.multiple_shipments_detected',${order.status},${JSON.stringify({ provider_order_id: order.enviopack_order_id, shipment_ids: shipments.map(item => item.id), source: 'manual_reconciliation' })}::jsonb)`;
    throw Object.assign(new Error('Envíopack informa múltiples envíos asociados. No generes otro hasta revisarlos.'), { status: 409, code: 'SHIPMENT_PROVIDER_MULTIPLE_MATCHES' });
  }

  const shipmentId = String(shipments[0].id);
  const existingOwner = await shipmentOwner(sql, shipmentId, id);
  if (existingOwner) {
    const marked = await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('El envío encontrado en Envíopack ya pertenece a otro pedido local. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id} AND shipping_generation_status IS DISTINCT FROM 'conflict' RETURNING id`;
    if (marked.length) await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_ownership_conflict',${order.status},${JSON.stringify({ shipment_id: shipmentId, conflict_order_id: existingOwner, source: 'manual_reconciliation' })}::jsonb)`;
    throw Object.assign(new Error('El envío encontrado ya está asociado a otro pedido local. Requiere revisión manual.'), { status: 409, code: 'SHIPMENT_OWNERSHIP_CONFLICT' });
  }

  let details = shipments[0];
  try { details = await getShipment(shipmentId); }
  catch (detailsError) { console.warn('reconciled shipment details unavailable:', 'code=' + String(detailsError?.code || detailsError?.name || 'DETAILS_ERROR'), 'status=' + String(detailsError?.providerStatus || 'unknown')); }
  const trackingNumber = clean(details?.tracking_number || details?.numero_tracking, 120) || null;
  const providerShipmentState = String(details?.estado || shipments[0]?.estado || '');
  const state = providerState(details, []);
  const currentRows = await sql`SELECT status,payment_status,payment_status_detail,shipping_status FROM orders WHERE id=${id} LIMIT 1`;
  const currentOrder = currentRows[0] || order;
  state.order = orderStatusFromShipping(currentOrder, state.order);
  state.shipping = shippingStatusFromProvider(currentOrder.shipping_status, state.shipping);
  const labelReady = providerShipmentState.toUpperCase() === 'P';
  let updated;
  try {
    updated = await sql`
      UPDATE orders SET enviopack_shipment_id=${shipmentId},enviopack_state=${providerShipmentState || null},
        tracking_number=${trackingNumber},shipping_label_ready=${labelReady},shipping_generation_status='created',
        shipping_status=${state.shipping},status=${state.order},shipping_created_at=COALESCE(shipping_created_at,NOW()),
        shipping_last_synced_at=NOW(),shipping_last_error=NULL,updated_at=NOW()
      WHERE id=${id} AND enviopack_shipment_id IS NULL
        AND shipping_generation_status IN ('uncertain','processing','failed','not_created')
        AND payment_status IS NOT DISTINCT FROM ${currentOrder.payment_status}
        AND payment_status_detail IS NOT DISTINCT FROM ${currentOrder.payment_status_detail}
        AND status=${currentOrder.status}
      RETURNING status,payment_status,payment_status_detail
    `;
  } catch (error) {
    const raceOwner = await shipmentConflictOwner(sql, error, shipmentId, id);
    if (raceOwner) {
      const marked = await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('El envío encontrado en Envíopack fue asociado a otro pedido durante la reconciliación. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id} AND shipping_generation_status IS DISTINCT FROM 'conflict' RETURNING id`;
      if (marked.length) await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_ownership_conflict',${order.status},${JSON.stringify({ shipment_id: shipmentId, conflict_order_id: raceOwner, source: 'reconciliation_unique_race' })}::jsonb)`;
      throw Object.assign(new Error('El envío fue asociado a otro pedido durante la reconciliación. Requiere revisión manual.'), { status: 409, code: 'SHIPMENT_OWNERSHIP_CONFLICT' });
    }
    throw error;
  }

  if (!updated.length) {
    const currentRows = await sql`SELECT enviopack_shipment_id,tracking_number,shipping_label_ready,status FROM orders WHERE id=${id} LIMIT 1`;
    const current = currentRows[0] || null;
    if (String(current?.enviopack_shipment_id || '') === shipmentId) {
      return { found: true, reused: true, shipment_id: shipmentId, tracking_number: current.tracking_number || trackingNumber, label_ready: Boolean(current.shipping_label_ready), order_status: current.status || state.order };
    }
    throw Object.assign(new Error('El pedido cambió mientras se verificaba Envíopack. Actualizá el panel antes de continuar.'), { status: 409, code: 'SHIPMENT_RECONCILIATION_RACE' });
  }

  await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'enviopack.shipment_reconciled',${order.status},${state.order},${JSON.stringify({ provider_order_id: order.enviopack_order_id, shipment_id: shipmentId, provider_state: providerShipmentState })}::jsonb)`;
  if (trackingNumber && updated[0]?.payment_status === 'approved' && !requiresPaymentReview(updated[0])) await queueAndSendOrderNotification(sql, id, 'shipment_created');
  return { found: true, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady, order_status: state.order };
}

async function syncShipment(sql, id) {
  const order = await loadFulfillmentOrder(sql, id);
  if (!order?.enviopack_shipment_id) throw Object.assign(new Error('El pedido todavía no tiene un envío generado.'), { status: 409 });
  if (order.shipping_last_synced_at && Date.now() - new Date(order.shipping_last_synced_at).getTime() < 60000) return { cached: true, order };

  const details = await getShipment(order.enviopack_shipment_id);
  let tracking = [];
  if (String(details?.estado || '').toUpperCase() === 'P') {
    try { tracking = await getShipmentTracking(order.enviopack_shipment_id); } catch (error) { console.warn('tracking unavailable:', 'code=' + String(error?.code || 'unknown'), 'status=' + String(error?.providerStatus || 'unknown')); }
  }
  const trackingNumber = clean(details?.tracking_number || details?.numero_tracking || order.tracking_number, 120) || null;
  const proposed = providerState(details, tracking);
  const providerShipmentState = String(details?.estado || '') || null;
  const labelReady = String(details?.estado || '').toUpperCase() === 'P';
  const persisted = await persistShippingObservation(sql, {
    orderId: id,
    providerState: providerShipmentState,
    trackingNumber,
    labelReady,
    proposedOrderStatus: proposed.order,
    proposedShippingStatus: proposed.shipping
  });

  if (!persisted.ok) {
    throw Object.assign(new Error('El pedido cambió mientras se sincronizaba Envíopack. Actualizá el panel y reintentá.'), { status: 409, code: 'SHIPMENT_SYNC_RACE' });
  }

  await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'enviopack.admin_sync',${persisted.before.status},${persisted.order.status},${JSON.stringify({ tracking_number: trackingNumber, tracking })}::jsonb)`;
  if (trackingNumber && trackingNumber !== persisted.before.tracking_number && persisted.order.payment_status === 'approved' && !requiresPaymentReview(persisted.order)) {
    await queueAndSendOrderNotification(sql, id, 'shipment_created');
  }
  if (persisted.order.status === 'delivered' && persisted.order.payment_status === 'approved' && !requiresPaymentReview(persisted.order)) {
    await ensureReviewInvites(sql, id);
    await queueAndSendOrderNotification(sql, id, 'review_invite');
  }
  return { cached: false, tracking_number: trackingNumber, label_ready: labelReady, shipping_status: persisted.order.shipping_status, events: tracking };
}

module.exports = async (req,res)=>{
  const query=searchParams(req);
  if(!verify(req)) return res.status(401).json({error:'No autorizado.'});
  const sql=getDb();
  try{
    if(req.method==='GET' && query.get('action')==='label'){
      const id=Number(query.get('id'));
      if(!Number.isInteger(id)||id<1) return res.status(400).json({error:'Pedido inválido.'});
      const rows=await sql`SELECT order_number,enviopack_shipment_id,shipping_label_ready FROM orders WHERE id=${id} LIMIT 1`;
      if(!rows.length||!rows[0].enviopack_shipment_id) return res.status(404).json({error:'El pedido no tiene un envío generado.'});
      if(!rows[0].shipping_label_ready) return res.status(409).json({error:'La etiqueta estará disponible cuando Envíopack termine de procesar el envío.'});
      const response=await getShipmentLabel(rows[0].enviopack_shipment_id);
      if(!response.ok) return res.status(response.status).json({error:'Envíopack todavía no pudo generar la etiqueta.'});
      const buffer=Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',`inline; filename="Mititoys-${clean(rows[0].order_number,50)}.pdf"`);
      res.setHeader('Cache-Control','private, no-store');
      return res.status(200).send(buffer);
    }

    if(req.method==='GET'){
      const orders=await sql`
        SELECT o.id,o.order_number,o.product_id,COALESCE((SELECT STRING_AGG(oi.product_title||' x'||oi.quantity,' · ' ORDER BY oi.id) FROM order_items oi WHERE oi.order_id=o.id),o.product_title) AS product_title,
          o.quantity,o.unit_price,o.subtotal_amount,o.shipping_amount,o.total_amount,o.currency,o.status,o.payment_id,o.payment_status,o.payment_status_detail,
          o.shipping_status,o.shipping_recipient,o.shipping_address,o.shipping_city,o.shipping_postal_code,o.shipping_province,o.shipping_phone,o.shipping_notes,
          o.shipping_provider,o.shipping_carrier_id,o.shipping_carrier,o.shipping_service,o.shipping_estimated_hours,o.tracking_number,
          o.shipping_destination_type,o.shipping_street,o.shipping_number,o.shipping_floor,o.shipping_unit,o.shipping_branch_id,o.shipping_branch_name,o.shipping_branch_address,
          o.enviopack_order_id,o.enviopack_shipment_id,o.enviopack_state,o.shipping_generation_status,o.shipping_last_error,o.shipping_label_ready,o.shipping_last_synced_at,
          o.created_at,o.updated_at,c.id AS customer_id,c.name AS customer_name,c.email AS customer_email,c.phone AS customer_phone,
          c.address AS customer_address,c.city AS customer_city,c.province AS customer_province,c.postal_code AS customer_postal_code
        FROM orders o LEFT JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 500
      `;
      const customers=await sql`SELECT c.id,c.name,c.email,c.phone,c.city,c.created_at,COUNT(o.id)::int AS orders_count,COALESCE(SUM(CASE WHEN o.payment_status='approved' THEN o.total_amount ELSE 0 END),0)::numeric AS total_spent FROM customers c LEFT JOIN orders o ON o.customer_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`;
      const products=await sql`SELECT id,title,description,images,price,stock_quantity,stock_managed,active,weight_kg,package_length_cm,package_width_cm,package_height_cm,created_at,updated_at FROM products ORDER BY active DESC,title ASC`;
      const uploaded=await sql`SELECT id,product_id,filename,mime_type,sort_order,created_at FROM product_images ORDER BY product_id,sort_order,id`;
      const productImages={};
      for(const image of uploaded){ if(!productImages[image.product_id]) productImages[image.product_id]=[]; productImages[image.product_id].push({id:image.id,filename:image.filename,mime_type:image.mime_type,sort_order:image.sort_order,url:'/api/product-image?id='+image.id}); }
      for(const product of products) product.uploaded_images=productImages[product.id]||[];
      return res.status(200).json({orders,customers,products});
    }

    if(req.method==='POST'){
      const id=Number(req.body?.id);
      const action=String(req.body?.action||'');
      if(!Number.isInteger(id)||id<1) return res.status(400).json({error:'Pedido inválido.'});
      if(action==='create_shipment') return res.status(200).json(await createShipment(sql,id));
      if(action==='reconcile_shipment') return res.status(200).json(await reconcileShipmentCreation(sql,id));
      if(action==='sync_shipment') return res.status(200).json(await syncShipment(sql,id));
      return res.status(400).json({error:'Acción no válida.'});
    }

    if(req.method==='PATCH'){
      const id=Number(req.body?.id); const status=String(req.body?.status||'');
      const tracking=req.body?.tracking_number==null?null:clean(req.body.tracking_number,120);
      const carrier=req.body?.shipping_carrier==null?null:clean(req.body.shipping_carrier,80);
      const recipient=req.body?.shipping_recipient==null?null:clean(req.body.shipping_recipient,160);
      const street=req.body?.shipping_street==null?null:clean(req.body.shipping_street,120);
      const number=req.body?.shipping_number==null?null:clean(req.body.shipping_number,10);
      const floor=req.body?.shipping_floor==null?null:clean(req.body.shipping_floor,10);
      const unit=req.body?.shipping_unit==null?null:clean(req.body.shipping_unit,10);
      const address=[street,number,floor?('Piso '+floor):'',unit?('Depto '+unit):''].filter(Boolean).join(' ');
      const city=req.body?.shipping_city==null?null:clean(req.body.shipping_city,100);
      const postal=req.body?.shipping_postal_code==null?null:clean(req.body.shipping_postal_code,20);
      const phone=req.body?.shipping_phone==null?null:clean(req.body.shipping_phone,50);
      const notes=req.body?.shipping_notes==null?null:clean(req.body.shipping_notes,1000);
      if(!Number.isInteger(id)||id<1||!VALID.has(status)) return res.status(400).json({error:'Datos de pedido inválidos.'});
      const before=await sql`SELECT status,payment_id,payment_status,payment_status_detail,preference_id FROM orders WHERE id=${id}`;
      if(!before.length) return res.status(404).json({error:'Pedido no encontrado.'});
      const previous=before[0];
      const transitionError=adminStatusError({currentStatus:previous.status,targetStatus:status,paymentId:previous.payment_id,paymentStatus:previous.payment_status,paymentStatusDetail:previous.payment_status_detail});
      if(transitionError) return res.status(409).json({error:transitionError});
      if(previous.status!==status && status==='cancelled' && !previous.payment_id && previous.preference_id) {
        try { await expirePreference(previous.preference_id); }
        catch(error) {
          console.warn('Mercado Pago preference expiration failed:', 'code=' + String(error?.code || 'MP_PREFERENCE_EXPIRE_FAILED'), 'status=' + String(error?.providerStatus || 'unknown'));
          return res.status(502).json({error:'No se pudo cancelar de forma segura el enlace de pago. No se modificó el pedido.'});
        }
      }
      const shippingStatus=status==='shipped'?'in_transit':status==='delivered'?'delivered':status==='processing'?'preparing':'not_shipped';
      const rows=await sql`UPDATE orders SET status=${status},shipping_status=${shippingStatus},shipping_recipient=${recipient},shipping_address=${address||null},shipping_street=${street},shipping_number=${number},shipping_floor=${floor},shipping_unit=${unit},shipping_city=${city},shipping_postal_code=${postal},shipping_phone=${phone},shipping_notes=${notes},shipping_carrier=${carrier},tracking_number=${tracking},updated_at=NOW() WHERE id=${id} RETURNING *`;
      let stockRelease=null;
      if(previous.status!==status && (status==='cancelled'||status==='refunded')) {
        stockRelease=await releaseReservedStockIfUnshipped(sql,id,status==='refunded'?'Liberación por reembolso confirmado':'Liberación por cancelación confirmada');
      }
      if(previous.status!==status){
        await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'admin.status_changed',${previous.status},${status},${JSON.stringify({tracking_number:tracking,shipping_carrier:carrier,stock_release:stockRelease})}::jsonb)`;
        const notificationType={approved:'payment_approved',processing:'order_processing',shipped:'shipment_created',cancelled:'order_cancelled',refunded:'order_refunded'}[status];
        if(notificationType) await queueAndSendOrderNotification(sql,id,notificationType);
        if(status==='delivered'){await ensureReviewInvites(sql,id);await queueAndSendOrderNotification(sql,id,'review_invite');}
      }
      return res.status(200).json({order:rows[0]});
    }

    if(req.method==='PUT'){
      const id=clean(req.body?.id,50); const stock=Number(req.body?.stock_quantity); const managed=Boolean(req.body?.stock_managed); const active=Boolean(req.body?.active); const price=Number(req.body?.price);
      const title=clean(req.body?.title,180); const description=clean(req.body?.description,6000);
      const images=Array.isArray(req.body?.images)?req.body.images.filter(x=>/^https?:\/\//i.test(String(x))).map(x=>clean(x,1000)).slice(0,8):[];
      if(!id||!title||!Number.isInteger(stock)||stock<0||!Number.isFinite(price)||price<0) return res.status(400).json({error:'Datos de producto inválidos.'});
      const current=await sql`SELECT stock_quantity FROM products WHERE id=${id}`;
      if(!current.length) return res.status(404).json({error:'Producto no encontrado.'});
      const delta=stock-Number(current[0].stock_quantity);
      const rows=await sql`UPDATE products SET title=${title},description=${description},images=${JSON.stringify(images)}::jsonb,stock_quantity=${stock},stock_managed=${managed},active=${active},price=${price},updated_at=NOW() WHERE id=${id} RETURNING *`;
      if(delta!==0) await sql`INSERT INTO inventory_movements(product_id,movement_type,quantity,reason) VALUES(${id},'adjustment',${delta},'Ajuste desde panel de administración')`;
      return res.status(200).json({product:rows[0]});
    }
    return res.status(405).json({error:'Método no permitido'});
  }catch(error){
    console.error('admin error:', 'code=' + String(error?.code || 'ADMIN_ERROR'), 'status=' + String(error?.providerStatus || error?.status || 'unknown'));
    const status=error.status||(['INSUFFICIENT_SHIPPING_BALANCE','SHIPPING_DEPOSIT_MISSING','PRODUCT_SHIPPING_DATA_MISSING'].includes(error.code)?409:500);
    return res.status(status).json({code:error.code||'ADMIN_ERROR',error:error.message||'Error interno del panel.'});
  }
};
