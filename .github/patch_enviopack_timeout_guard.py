from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'{label} target missing')
    p.write_text(s.replace(old, new, 1))

# lib/shipping.js: classify transport failures for mutating calls without leaking provider/network text.
replace_once(
    'lib/shipping.js',
    """  const response = await fetch(`https://api.enviopack.com${path}${separator}access_token=${encodeURIComponent(token)}`, {
    method: options.method || 'GET',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || 12000)
  });
  const data = await response.json().catch(() => null);
""",
    """  let response;
  let data;
  try {
    response = await fetch(`https://api.enviopack.com${path}${separator}access_token=${encodeURIComponent(token)}`, {
      method: options.method || 'GET',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeout || 12000)
    });
    data = await response.json().catch(() => null);
  } catch (error) {
    if (options.uncertainOnTransportError) {
      throw Object.assign(new Error('No se pudo confirmar si Envíopack completó la operación.'), { code: 'SHIPPING_PROVIDER_UNCERTAIN' });
    }
    throw Object.assign(new Error('No se pudo comunicar con Envíopack.'), { code: 'SHIPPING_PROVIDER_ERROR' });
  }
""",
    'shipping transport wrapper'
)

replace_once(
    'lib/shipping.js',
    """async function createConfirmedShipment({ providerOrderId, order, packages, quote }) {
""",
    """async function listEnviopackOrderShipments(providerOrderId) {
  const id = String(providerOrderId || '').trim();
  if (!id) return [];
  const data = await enviopackJson(`/pedidos/${encodeURIComponent(id)}/envios`);
  const list = Array.isArray(data) ? data : Array.isArray(data?.envios) ? data.envios : Array.isArray(data?.data) ? data.data : [];
  return list
    .map(item => ({ ...(item && typeof item === 'object' ? item : {}), id: String(item?.id || '').trim() }))
    .filter(item => item.id);
}

async function createConfirmedShipment({ providerOrderId, order, packages, quote }) {
""",
    'provider shipment listing helper'
)

replace_once(
    'lib/shipping.js',
    """  const data = await enviopackJson('/envios', { method: 'POST', body: payload, timeout: 15000 });
""",
    """  const data = await enviopackJson('/envios', { method: 'POST', body: payload, timeout: 15000, uncertainOnTransportError: true });
""",
    'shipment uncertain mutation marker'
)

replace_once(
    'lib/shipping.js',
    """  getOrCreateEnviopackOrder,
  createConfirmedShipment,
""",
    """  getOrCreateEnviopackOrder,
  listEnviopackOrderShipments,
  createConfirmedShipment,
""",
    'shipping helper export'
)

# api/admin.js: preflight provider state, block ambiguous retries, and add explicit reconciliation.
replace_once(
    'api/admin.js',
    """  getShipment, getShipmentTracking, getShipmentLabel
""",
    """  getShipment, getShipmentTracking, getShipmentLabel, listEnviopackOrderShipments
""",
    'admin shipping import'
)

replace_once(
    'api/admin.js',
    """async function createShipment(sql, id) {
  let providerShipment = null;
  let order = await loadFulfillmentOrder(sql, id);
""",
    """async function createShipment(sql, id) {
  let providerShipment = null;
  let providerOrderId = null;
  let providerShipmentsBefore = [];
  let reusedProviderShipment = false;
  let order = await loadFulfillmentOrder(sql, id);
""",
    'create shipment state variables'
)

replace_once(
    'api/admin.js',
    """    const providerOrderId = order.enviopack_order_id || await getOrCreateEnviopackOrder({
""",
    """    providerOrderId = order.enviopack_order_id || await getOrCreateEnviopackOrder({
""",
    'provider order assignment'
)

replace_once(
    'api/admin.js',
    """    const shipment = await createConfirmedShipment({
      providerOrderId,
      order,
      packages,
      quote: { service_code: order.service_code, carrier_id: order.shipping_carrier_id, dispatch_mode: order.dispatch_mode }
    });
""",
    """    providerShipmentsBefore = await listEnviopackOrderShipments(providerOrderId);
    if (providerShipmentsBefore.length > 1) {
      await sql`UPDATE orders SET shipping_generation_status='conflict',shipping_last_error=${clean('Envíopack ya tiene múltiples envíos asociados a este pedido. Requiere revisión manual.',1000)},updated_at=NOW() WHERE id=${id}`;
      await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.multiple_shipments_detected',${order.status},${JSON.stringify({ provider_order_id: providerOrderId, shipment_ids: providerShipmentsBefore.map(item => item.id) })}::jsonb)`;
      throw Object.assign(new Error('Envíopack ya tiene múltiples envíos asociados a este pedido. No generes otro hasta revisarlos.'), { status: 409, code: 'SHIPMENT_PROVIDER_MULTIPLE_MATCHES' });
    }

    let shipment;
    if (providerShipmentsBefore.length === 1) {
      shipment = await getShipment(providerShipmentsBefore[0].id);
      reusedProviderShipment = true;
    } else {
      shipment = await createConfirmedShipment({
        providerOrderId,
        order,
        packages,
        quote: { service_code: order.service_code, carrier_id: order.shipping_carrier_id, dispatch_mode: order.dispatch_mode }
      });
    }
""",
    'shipment provider preflight'
)

replace_once(
    'api/admin.js',
    """    return { reused: false, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady, order_status: finalOrderStatus };
""",
    """    return { reused: reusedProviderShipment, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady, order_status: finalOrderStatus };
""",
    'shipment reused return'
)

replace_once(
    'api/admin.js',
    """if (error?.code === 'SHIPMENT_OWNERSHIP_CONFLICT') throw error;
if (providerShipment?.id) {
""",
    """if (['SHIPMENT_OWNERSHIP_CONFLICT','SHIPMENT_PROVIDER_MULTIPLE_MATCHES'].includes(error?.code)) throw error;
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
    try { providerShipment = await getShipment(newShipments[0].id); }
    catch (recoveryError) { console.warn('shipment timeout recovery fetch failed:', 'code=' + String(recoveryError?.code || recoveryError?.name || 'RECOVERY_ERROR')); }
  }
  if (!providerShipment) {
    await sql`UPDATE orders SET shipping_generation_status='uncertain',shipping_last_error=${clean('No se pudo confirmar si Envíopack creó el envío. No generes otro: usá Verificar en Envíopack.',1000)},updated_at=NOW() WHERE id=${id}`;
    await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_creation_uncertain',${order.status},${JSON.stringify({ provider_order_id: providerOrderId })}::jsonb)`;
    throw Object.assign(new Error('No se pudo confirmar si Envíopack creó el envío. No lo vuelvas a generar; usá Verificar en Envíopack.'), { status: 409, code: 'SHIPMENT_CREATION_UNCERTAIN' });
  }
}
if (providerShipment?.id) {
""",
    'ambiguous shipment catch'
)

reconcile_function = r'''
async function reconcileShipmentCreation(sql, id) {
  const order = await loadFulfillmentOrder(sql, id);
  if (!order) throw Object.assign(new Error('Pedido no encontrado.'), { status: 404 });
  if (order.enviopack_shipment_id) return { found: true, reused: true, shipment_id: String(order.enviopack_shipment_id) };
  if (!order.enviopack_order_id) throw Object.assign(new Error('El pedido todavía no tiene una orden asociada en Envíopack.'), { status: 409, code: 'ENVI0PACK_ORDER_MISSING' });

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

  const details = await getShipment(shipmentId);
  const trackingNumber = clean(details?.tracking_number || details?.numero_tracking, 120) || null;
  const providerShipmentState = String(details?.estado || shipments[0]?.estado || '');
  const state = providerState(details, []);
  state.order = orderStatusFromShipping(order, state.order);
  state.shipping = shippingStatusFromProvider(order.shipping_status, state.shipping);
  const labelReady = providerShipmentState.toUpperCase() === 'P';
  const updated = await sql`
    UPDATE orders SET enviopack_shipment_id=${shipmentId},enviopack_state=${providerShipmentState || null},
      tracking_number=${trackingNumber},shipping_label_ready=${labelReady},shipping_generation_status='created',
      shipping_status=${state.shipping},status=${state.order},shipping_last_synced_at=NOW(),shipping_last_error=NULL,updated_at=NOW()
    WHERE id=${id}
    RETURNING status,payment_status
  `;
  await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'enviopack.shipment_reconciled',${order.status},${state.order},${JSON.stringify({ provider_order_id: order.enviopack_order_id, shipment_id: shipmentId, provider_state: providerShipmentState })}::jsonb)`;
  if (trackingNumber && updated[0]?.payment_status === 'approved') await queueAndSendOrderNotification(sql, id, 'shipment_created');
  return { found: true, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady, order_status: state.order };
}

'''
replace_once(
    'api/admin.js',
    """async function syncShipment(sql, id) {
""",
    reconcile_function + "async function syncShipment(sql, id) {\n",
    'shipment reconciliation function'
)

replace_once(
    'api/admin.js',
    """      if(action==='create_shipment') return res.status(200).json(await createShipment(sql,id));
      if(action==='sync_shipment') return res.status(200).json(await syncShipment(sql,id));
""",
    """      if(action==='create_shipment') return res.status(200).json(await createShipment(sql,id));
      if(action==='reconcile_shipment') return res.status(200).json(await reconcileShipmentCreation(sql,id));
      if(action==='sync_shipment') return res.status(200).json(await syncShipment(sql,id));
""",
    'admin reconciliation route'
)

# admin.html: only allow automatic creation from safe states; uncertain/processing gets a reconcile action.
p = Path('admin.html')
s = p.read_text()
old = "${o.payment_status==='approved'&&!o.enviopack_shipment_id?'<button class=\"create\" onclick=\"generateShipment('+o.id+',this)\">🚚 GENERAR ENVÍO</button>':''}${o.enviopack_shipment_id?"
new = "${o.payment_status==='approved'&&!o.enviopack_shipment_id&&['not_created','failed'].includes(String(o.shipping_generation_status||'not_created'))?'<button class=\"create\" onclick=\"generateShipment('+o.id+',this)\">🚚 GENERAR ENVÍO</button>':''}${!o.enviopack_shipment_id&&o.enviopack_order_id&&['uncertain','processing'].includes(String(o.shipping_generation_status||''))?'<button class=\"sync\" onclick=\"reconcileShipment('+o.id+',this)\">🔎 VERIFICAR EN ENVÍOPACK</button>':''}${o.enviopack_shipment_id?"
if old not in s:
    raise SystemExit('admin UI shipment action target missing')
s = s.replace(old, new, 1)

old = "button.textContent=action==='create_shipment'?'GENERANDO...':'ACTUALIZANDO...';"
new = "button.textContent=action==='create_shipment'?'GENERANDO...':action==='reconcile_shipment'?'VERIFICANDO...':'ACTUALIZANDO...';"
if old not in s:
    raise SystemExit('admin UI action text target missing')
s = s.replace(old, new, 1)

old = "if(action==='create_shipment')alert(j.reused?'El envío ya existía y no se duplicó.':'Envío generado correctamente. La etiqueta aparecerá cuando Envíopack termine de procesarlo.')}catch(e)"
new = "if(action==='create_shipment')alert(j.reused?'El envío ya existía y no se duplicó.':'Envío generado correctamente. La etiqueta aparecerá cuando Envíopack termine de procesarlo.');if(action==='reconcile_shipment')alert(j.found?'Envío encontrado en Envíopack y vinculado al pedido.':'Todavía no aparece un envío en Envíopack. No generes otro hasta confirmar el resultado.')}catch(e)"
if old not in s:
    raise SystemExit('admin UI action alert target missing')
s = s.replace(old, new, 1)

old = "async function generateShipment(id,button){return shipmentAction(id,'create_shipment',button)}async function syncShipment(id,button){return shipmentAction(id,'sync_shipment',button)}"
new = "async function generateShipment(id,button){return shipmentAction(id,'create_shipment',button)}async function reconcileShipment(id,button){return shipmentAction(id,'reconcile_shipment',button)}async function syncShipment(id,button){return shipmentAction(id,'sync_shipment',button)}"
if old not in s:
    raise SystemExit('admin UI reconcile function target missing')
s = s.replace(old, new, 1)
p.write_text(s)
