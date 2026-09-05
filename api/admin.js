const { getDb } = require('../lib/db');
const { verify } = require('./admin-auth');
const {
  buildPackages, getOrCreateEnviopackOrder, createConfirmedShipment,
  getShipment, getShipmentTracking, getShipmentLabel
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
  let order = await loadFulfillmentOrder(sql, id);
  if (!order) throw Object.assign(new Error('Pedido no encontrado.'), { status: 404 });
  if (order.enviopack_shipment_id) return { reused: true, order };
  if (order.payment_status !== 'approved') throw Object.assign(new Error('El envío solo puede generarse cuando Mercado Pago confirma el pago.'), { status: 409 });
  if (!order.shipping_quote_id || order.shipping_provider !== 'enviopack') throw Object.assign(new Error('Este pedido no tiene una cotización de Envíopack asociada.'), { status: 409 });

  const claim = await sql`
    UPDATE orders SET shipping_generation_status='processing',shipping_last_error=NULL,updated_at=NOW()
    WHERE id=${id} AND enviopack_shipment_id IS NULL AND shipping_generation_status IN ('not_created','failed')
    RETURNING id
  `;
  if (!claim.length) throw Object.assign(new Error('El envío ya se está generando. Actualizá el panel en unos segundos.'), { status: 409 });

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
    const providerOrderId = order.enviopack_order_id || await getOrCreateEnviopackOrder({
      order,
      customer: { name: order.customer_name, email: order.customer_email, phone: order.customer_phone },
      items
    });
    await sql`UPDATE orders SET enviopack_order_id=${providerOrderId},updated_at=NOW() WHERE id=${id}`;

    const shipment = await createConfirmedShipment({
      providerOrderId,
      order,
      packages,
      quote: { service_code: order.service_code, carrier_id: order.shipping_carrier_id, dispatch_mode: order.dispatch_mode }
    });
    const shipmentId = String(shipment.id);
    const providerShipmentState = String(shipment.estado || '');
    const trackingNumber = clean(shipment.tracking_number || shipment.numero_tracking, 120) || null;
    const labelReady = providerShipmentState.toUpperCase() === 'P';
    await sql`
      UPDATE orders SET
        enviopack_shipment_id=${shipmentId},enviopack_state=${providerShipmentState || null},
        shipping_destination_type=${order.shipping_destination_type},
        shipping_street=${order.shipping_street || null},shipping_number=${order.shipping_number || null},
        shipping_branch_id=${order.shipping_branch_id || null},shipping_branch_name=${order.shipping_branch_name || null},
        shipping_branch_address=${order.shipping_branch_address || null},
        tracking_number=${trackingNumber},shipping_label_ready=${labelReady},
        shipping_generation_status='created',shipping_status='preparing',status='processing',
        shipping_created_at=NOW(),shipping_last_synced_at=NOW(),shipping_last_error=NULL,updated_at=NOW()
      WHERE id=${id}
    `;
    await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${id},'enviopack.shipment_created','processing',${JSON.stringify({ provider_order_id: providerOrderId, shipment_id: shipmentId, provider_state: providerShipmentState, tracking_number: trackingNumber })}::jsonb)`;
    if (trackingNumber) await queueAndSendOrderNotification(sql, id, 'shipment_created');
    return { reused: false, shipment_id: shipmentId, tracking_number: trackingNumber, label_ready: labelReady };
  } catch (error) {
    await sql`UPDATE orders SET shipping_generation_status='failed',shipping_last_error=${clean(error.message, 1000)},updated_at=NOW() WHERE id=${id}`;
    throw error;
  }
}

async function syncShipment(sql, id) {
  const order = await loadFulfillmentOrder(sql, id);
  if (!order?.enviopack_shipment_id) throw Object.assign(new Error('El pedido todavía no tiene un envío generado.'), { status: 409 });
  if (order.shipping_last_synced_at && Date.now() - new Date(order.shipping_last_synced_at).getTime() < 60000) return { cached: true, order };

  const details = await getShipment(order.enviopack_shipment_id);
  let tracking = [];
  if (String(details?.estado || '').toUpperCase() === 'P') {
    try { tracking = await getShipmentTracking(order.enviopack_shipment_id); } catch (error) { console.warn('tracking unavailable:', error.message); }
  }
  const trackingNumber = clean(details?.tracking_number || details?.numero_tracking || order.tracking_number, 120) || null;
  const state = providerState(details, tracking);
  const labelReady = String(details?.estado || '').toUpperCase() === 'P';
  await sql`
    UPDATE orders SET enviopack_state=${String(details?.estado || '') || null},tracking_number=${trackingNumber},
      shipping_label_ready=${labelReady},shipping_status=${state.shipping},status=${state.order},
      shipping_last_synced_at=NOW(),shipping_last_error=NULL,updated_at=NOW()
    WHERE id=${id}
  `;
  await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'enviopack.admin_sync',${order.status},${state.order},${JSON.stringify({ tracking_number: trackingNumber, tracking })}::jsonb)`;
  if (trackingNumber && trackingNumber !== order.tracking_number) await queueAndSendOrderNotification(sql, id, 'shipment_created');
  if (state.order === 'delivered') {
    await ensureReviewInvites(sql, id);
    await queueAndSendOrderNotification(sql, id, 'review_invite');
  }
  return { cached: false, tracking_number: trackingNumber, label_ready: labelReady, shipping_status: state.shipping, events: tracking };
}

module.exports = async (req,res)=>{
  if(!verify(req)) return res.status(401).json({error:'No autorizado.'});
  const sql=getDb();
  try{
    if(req.method==='GET' && req.query?.action==='label'){
      const id=Number(req.query?.id);
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
      const before=await sql`SELECT status FROM orders WHERE id=${id}`;
      if(!before.length) return res.status(404).json({error:'Pedido no encontrado.'});
      const shippingStatus=status==='shipped'?'in_transit':status==='delivered'?'delivered':status==='processing'?'preparing':'not_shipped';
      const rows=await sql`UPDATE orders SET status=${status},shipping_status=${shippingStatus},shipping_recipient=${recipient},shipping_address=${address||null},shipping_street=${street},shipping_number=${number},shipping_floor=${floor},shipping_unit=${unit},shipping_city=${city},shipping_postal_code=${postal},shipping_phone=${phone},shipping_notes=${notes},shipping_carrier=${carrier},tracking_number=${tracking},updated_at=NOW() WHERE id=${id} RETURNING *`;
      if(before[0].status!==status){
        await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'admin.status_changed',${before[0].status},${status},${JSON.stringify({tracking_number:tracking,shipping_carrier:carrier})}::jsonb)`;
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
    console.error('admin error:',error);
    const status=error.status||(['INSUFFICIENT_SHIPPING_BALANCE','SHIPPING_DEPOSIT_MISSING','PRODUCT_SHIPPING_DATA_MISSING'].includes(error.code)?409:500);
    return res.status(status).json({code:error.code||'ADMIN_ERROR',error:error.message||'Error interno del panel.'});
  }
};
