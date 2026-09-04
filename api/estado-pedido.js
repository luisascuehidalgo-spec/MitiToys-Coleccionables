const { getDb } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const number = String(req.query?.pedido || '').trim().slice(0, 80);
    const email = String(req.query?.email || '').trim().toLowerCase().slice(0, 160);
    if (!number) return res.status(400).json({ error: 'Falta el número de pedido.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ingresá el email utilizado en la compra.' });

    const sql = getDb();
    const rows = await sql`
      SELECT o.id,o.order_number,o.product_title,o.quantity,o.subtotal_amount,o.shipping_amount,o.total_amount,o.currency,
        o.status,o.payment_status,o.payment_status_detail,o.shipping_status,o.shipping_recipient,o.shipping_city,o.shipping_province,
        o.shipping_carrier,o.shipping_service,o.shipping_estimated_hours,o.tracking_number,o.shipping_destination_type,
        o.shipping_branch_name,o.shipping_branch_address,o.shipping_label_ready,o.created_at,o.updated_at
      FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number=${number} AND LOWER(c.email)=${email} LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ error: 'No encontramos un pedido que coincida con ese número y email.' });

    const order = rows[0];
    const [items, events] = await Promise.all([
      sql`SELECT product_id,product_title,quantity,unit_price,total_amount FROM order_items WHERE order_id=${order.id} ORDER BY id`,
      sql`SELECT event_type,new_status,payload,created_at FROM order_events WHERE order_id=${order.id} ORDER BY created_at,id`
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
      .filter(event => ['order.created','payment.created','payment.updated','enviopack.shipment_created','enviopack.synced','enviopack.admin_sync','admin.status_changed'].includes(event.event_type))
      .map(event => ({ type: event.event_type, status: event.new_status, date: event.created_at }));

    delete order.id;
    order.items = items;
    order.timeline = timeline;
    order.tracking_events = providerTracking.map(({ key, ...entry }) => entry);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({ order });
  } catch (error) {
    console.error('estado-pedido error:', error);
    return res.status(500).json({ error: 'No se pudo consultar el pedido.' });
  }
};
