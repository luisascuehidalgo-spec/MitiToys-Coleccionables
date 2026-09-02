const { getDb } = require('../lib/db');

const PRODUCTOS = {
  "3377": { id: "3377", title: "Figura Luffy Gear 5 – Nika – One Piece – 31 cm", description: "Figura coleccionable de Monkey D. Luffy Gear 5 / Nika, One Piece. 31 cm aprox., PVC, incluye figura + caja.", price: 150000, picture_url: "https://raw.githubusercontent.com/luisascuehidalgo-spec/imagenes/main/20241123034449_1.jpg" },
  "3375": { id: "3375", title: "Figura One Piece Kaido Dragón 30 Cm PVC Coleccionable Anime", description: "Estatua coleccionable de Kaido con dragón azul. 30 cm aprox. de altura, 37 cm aprox. de ancho, PVC.", price: 300000, picture_url: "https://raw.githubusercontent.com/luisascuehidalgo-spec/COD-3375/main/D_NQ_NP_2X_758000-MLA115602430906_092026-F.webp" }
};

const clean = (v, max=200) => String(v || '').trim().slice(0,max);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'Falta configurar MERCADOPAGO_ACCESS_TOKEN en Vercel.' });

  try {
    const body = req.body || {};
    const product = PRODUCTOS[String(body.productId)];
    if (!product) return res.status(400).json({ error: 'Producto no válido.' });
    const origin = req.headers.origin || 'https://otaku-collectibles.vercel.app';
    let externalReference = `MITITOYS-${product.id}`;
    let orderNumber = null;
    let orderId = null;

    // Cuando la base está configurada, creamos el pedido antes de abrir Checkout Pro.
    // Si todavía no está configurada, mantenemos el flujo anterior para no interrumpir las ventas.
    if (process.env.DATABASE_URL) {
      const sql = getDb();
      const c = body.customer || {};
      let customerId = null;
      const email = clean(c.email,160).toLowerCase();
      if (email && /^\S+@\S+\.\S+$/.test(email)) {
        const rows = await sql`
          INSERT INTO customers (name,email,phone,address,city,postal_code)
          VALUES (${clean(c.name,120) || 'Cliente'},${email},${clean(c.phone,50)||null},${clean(c.address,200)||null},${clean(c.city,100)||null},${clean(c.postal_code,20)||null})
          ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, phone=COALESCE(EXCLUDED.phone,customers.phone), address=COALESCE(EXCLUDED.address,customers.address), city=COALESCE(EXCLUDED.city,customers.city), postal_code=COALESCE(EXCLUDED.postal_code,customers.postal_code)
          RETURNING id`;
        customerId = rows[0].id;
      }
      const orderRows = await sql`
        INSERT INTO orders (order_number,customer_id,product_id,product_title,quantity,unit_price,total_amount,external_reference)
        VALUES ('MT-' || TO_CHAR(NOW(),'YYYYMMDDHH24MISSMS') || '-' || SUBSTRING(MD5(RANDOM()::text),1,6),${customerId},${product.id},${product.title},1,${product.price},${product.price},${`MITITOYS-PENDING-${Date.now()}-${Math.random().toString(36).slice(2,8)}`})
        RETURNING id,order_number`;
      orderId = orderRows[0].id;
      orderNumber = orderRows[0].order_number;
      externalReference = `MITITOYS-ORDER-${orderId}`;
      await sql`UPDATE orders SET external_reference=${externalReference} WHERE id=${orderId}`;
    }

    const preference = {
      items: [{ id: product.id, title: product.title, description: product.description, picture_url: product.picture_url, quantity: 1, currency_id: 'ARS', unit_price: product.price }],
      ...(body.customer?.email ? { payer: { name: clean(body.customer.name,120), email: clean(body.customer.email,160).toLowerCase() } } : {}),
      external_reference: externalReference,
      back_urls: {
        success: `${origin}/?pago=exitoso${orderNumber ? `&pedido=${encodeURIComponent(orderNumber)}` : ''}`,
        pending: `${origin}/?pago=pendiente${orderNumber ? `&pedido=${encodeURIComponent(orderNumber)}` : ''}`,
        failure: `${origin}/?pago=fallido${orderNumber ? `&pedido=${encodeURIComponent(orderNumber)}` : ''}`
      },
      auto_return: 'approved',
      statement_descriptor: 'MITITOYS'
    };

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(preference)
    });
    const data = await response.json();
    if (!response.ok) {
      if (orderId && process.env.DATABASE_URL) await getDb()`UPDATE orders SET status='cancelled' WHERE id=${orderId}`;
      console.error('Mercado Pago error:', data);
      return res.status(response.status).json({ error: 'Mercado Pago rechazó la creación del pago.' });
    }

    if (orderId && process.env.DATABASE_URL) {
      const sql = getDb();
      await sql`UPDATE orders SET preference_id=${data.id} WHERE id=${orderId}`;
      await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${orderId},'order.created','pending',${JSON.stringify({preference_id:data.id})})`;
    }
    return res.status(200).json({ init_point: data.init_point, preference_id: data.id, order_number: orderNumber });
  } catch (error) {
    console.error('crear-preferencia error:', error);
    return res.status(500).json({ error: 'No se pudo crear el pago.' });
  }
};
