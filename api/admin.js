const { getDb } = require('../lib/db');
const { verify } = require('./admin-auth');

const VALID = new Set(['pending','approved','processing','shipped','delivered','cancelled','refunded']);

module.exports = async (req, res) => {
  if (!verify(req)) return res.status(401).json({ error: 'No autorizado.' });
  const sql = getDb();

  try {
    if (req.method === 'GET') {
      const orders = await sql`
        SELECT o.id, o.order_number, o.product_title, o.quantity, o.unit_price, o.total_amount, o.currency,
               o.status, o.payment_id, o.payment_status, o.payment_status_detail, o.shipping_status,
               o.tracking_number, o.created_at, o.updated_at,
               c.id AS customer_id, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
               c.address AS customer_address, c.city AS customer_city, c.postal_code AS customer_postal_code
        FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
        ORDER BY o.created_at DESC LIMIT 500
      `;
      const customers = await sql`
        SELECT c.id, c.name, c.email, c.phone, c.city, c.created_at,
               COUNT(o.id)::int AS orders_count, COALESCE(SUM(o.total_amount),0)::numeric AS total_spent
        FROM customers c LEFT JOIN orders o ON o.customer_id=c.id
        GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500
      `;
      return res.status(200).json({ orders, customers });
    }

    if (req.method === 'PATCH') {
      const id = Number(req.body?.id);
      const status = String(req.body?.status || '');
      const tracking = req.body?.tracking_number == null ? null : String(req.body.tracking_number).trim().slice(0, 120);
      const notes = req.body?.notes == null ? null : String(req.body.notes).trim().slice(0, 1000);
      if (!Number.isInteger(id) || id < 1 || !VALID.has(status)) return res.status(400).json({ error: 'Datos de pedido inválidos.' });
      const before = await sql`SELECT status FROM orders WHERE id=${id}`;
      if (!before.length) return res.status(404).json({ error: 'Pedido no encontrado.' });
      const rows = await sql`UPDATE orders SET status=${status}, shipping_status=${status==='shipped'?'shipped':status==='delivered'?'delivered':status==='processing'?'preparing':'not_shipped'}, tracking_number=${tracking}, notes=${notes} WHERE id=${id} RETURNING *`;
      if (before[0].status !== status) await sql`INSERT INTO order_events (order_id,event_type,old_status,new_status,payload) VALUES (${id},'admin.status_changed',${before[0].status},${status},${JSON.stringify({tracking_number:tracking})})`;
      return res.status(200).json({ order: rows[0] });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('admin error:', error);
    return res.status(500).json({ error: 'Error interno del panel.' });
  }
};
