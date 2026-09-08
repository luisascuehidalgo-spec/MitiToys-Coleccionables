const { getDb } = require('../lib/db');
const { ensureReviewInvites } = require('../lib/notifications');
const { searchParams } = require('../lib/request-url');
const { publicOrderStatus } = require('../lib/order-state');
const { PREFERENCE_TTL_MS } = require('../lib/payments');

function safePendingPaymentUrl(order) {
  if (order?.status !== 'pending' || String(order?.payment_status || 'pending') !== 'pending') return null;
  if (!order?.payment_url) return null;
  if (Date.now() - new Date(order.created_at).getTime() >= PREFERENCE_TTL_MS) return null;
  try {
    const url = new URL(String(order.payment_url));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return null;
    if (!(host === 'mercadopago.com' || host.endsWith('.mercadopago.com') || host === 'mercadopago.com.ar' || host.endsWith('.mercadopago.com.ar'))) return null;
    return url.toString();
  } catch (_) {
    return null;
  }
}

function publicPaymentDetail(detail) {
  if (detail === 'preference_uncertain') return 'Estamos verificando el enlace de pago';
  if (detail === 'preference_not_found') return 'El enlace de pago no pudo confirmarse';
  if (detail === 'amount_or_currency_mismatch') return 'Pago en revisión';
  return detail || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const query = searchParams(req);
    const number = String(query.get('pedido') || '').trim().slice(0, 80);
    const email = String(query.get('email') || '').trim().toLowerCase().slice(0, 160);
    if (!number) return res.status(400).json({ error: 'Falta el número de pedido.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ingresá el email utilizado en la compra.' });

    const sql = getDb();
    const rows = await sql`
      SELECT o.id,o.order_number,o.product_title,o.quantity,o.subtotal_amount,o.shipping_amount,o.total_amount,o.currency,
        o.status,o.payment_status,o.payment_status_detail,o.preference_id,o.payment_url,o.shipping_status,o.shipping_recipient,o.shipping_city,o.shipping_province,
        o.shipping_carrier,o.shipping_service,o.shipping_estimated_hours,o.tracking_number,o.shipping_destination_type,
        o.shipping_branch_name,o.shipping_branch_address,o.shipping_label_ready,o.created_at,o.updated_at
      FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number=${number} AND LOWER(c.email)=${email} LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ error: 'No encontramos un pedido que coincida con ese número y email.' });

    const order = rows[0];
    order.status = publicOrderStatus(order);
    order.payment_url = safePendingPaymentUrl(order);
    order.payment_status_detail = publicPaymentDetail(order.payment_status_detail);
    if (order.status === 'delivered') await ensureReviewInvites(sql, order.id);
    const [items, events, reviewInvites] = await Promise.all([
      sql`SELECT product_id,product_title,quantity,unit_price,total_amount FROM order_items WHERE order_id=${order.id} ORDER BY id`,
      sql`SELECT event_type,new_status,payload,created_at FROM order_events WHERE order_id=${order.id} ORDER BY created_at,id`,
      sql`SELECT r.product_id,r.review_token,r.status,p.title AS product_title FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.order_id=${order.id} ORDER BY r.id`
    ]);
    const providerTracking = [];
    for (const event of events) {
      const tracking = Array.isArray(event.payload?.tracking) ? event.payload.tracking : [];
      for (const entry of tracking) {
        const key = `${entry.fecha || ''}|${entry.mensaje || ''}`;
        if (!providerTracking.some(item => item.key === key)) providerTracking.push({ key, date: entry.fecha || null, message: String(entry.mensaje || '').slice(0, 250) });
      }
    }
    const timeline = events
      .filter(event => ['order.created','payment.created','payment.updated','payment.validation_failed','payment.preference_uncertain','payment.preference_recovered','payment.preference_expired','checkout.expired','enviopack.shipment_created','enviopack.synced','enviopack.admin_sync','admin.status_changed'].includes(event.event_type))
      .map(event => ({ type: event.event_type, status: event.new_status, date: event.created_at }));

    delete order.id;
    order.items = items;
    order.timeline = timeline;
    order.tracking_events = providerTracking.map(({ key, ...entry }) => entry);
    order.review_links = order.status === 'delivered' ? reviewInvites.map(review => ({ product_id: review.product_id, product_title: review.product_title, status: review.status, url: '/opinar.html?token=' + encodeURIComponent(review.review_token) })) : [];
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({ order });
  } catch (error) {
    console.error('estado-pedido error:', 'code=' + String(error?.code || error?.name || 'ORDER_STATUS_ERROR'), 'status=' + String(error?.status || 'unknown'));
    return res.status(500).json({ error: 'No se pudo consultar el pedido.' });
  }
};
