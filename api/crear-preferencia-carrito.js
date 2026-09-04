const { getDb } = require('../lib/db');
const {
  shippingEnabled,
  normalizePostalCode,
  normalizeProvinceCode,
  normalizeCart,
  cartHash
} = require('../lib/shipping');

const clean = (value, max = 200) => String(value || '').trim().slice(0, max);
const PRODUCTOS = {
  '3377': { id: '3377', title: 'Figura Luffy Gear 5 – Nika – One Piece – 31 cm', description: 'Figura coleccionable de Monkey D. Luffy Gear 5 / Nika, One Piece. 31 cm aprox., PVC, incluye figura + caja.', price: 150000, picture_url: 'https://raw.githubusercontent.com/luisascuehidalgo-spec/imagenes/main/20241123034449_1.jpg' },
  '3375': { id: '3375', title: 'Figura One Piece Kaido Dragón 30 Cm PVC Coleccionable Anime', description: 'Estatua coleccionable de Kaido con dragón azul. 30 cm aprox. de altura, 37 cm aprox. de ancho, PVC.', price: 300000, picture_url: 'https://raw.githubusercontent.com/luisascuehidalgo-spec/COD-3375/main/D_NQ_NP_2X_758000-MLA115602430906_092026-F.webp' }
};

async function releaseReservedStock(sql, orderId, reserved, reason) {
  for (const item of reserved) {
    try {
      await sql`UPDATE products SET stock_quantity=stock_quantity+${item.qty},updated_at=NOW() WHERE id=${item.id}`;
      await sql`INSERT INTO inventory_movements(product_id,order_id,movement_type,quantity,reason) VALUES(${item.id},${orderId},'release',${item.qty},${reason})`;
    } catch (error) {
      console.error('No se pudo liberar stock:', item.id, error);
    }
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) return res.status(500).json({ error: 'Falta configurar Mercado Pago.' });

  let sql = null;
  let orderId = null;
  let shippingQuoteId = null;
  const reserved = [];

  try {
    const body = req.body || {};
    const normalizedItems = normalizeCart(body.items);
    if (!normalizedItems.length) return res.status(400).json({ error: 'El carrito está vacío.' });

    const customer = body.customer || {};
    const email = clean(customer.email, 160).toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ingresá un email válido para continuar.' });

    const origin = req.headers.origin || 'https://otaku-collectibles.vercel.app';
    sql = getDb();
    const items = [];

    for (const requested of normalizedItems) {
      const rows = await sql`SELECT id,title,description,price,stock_quantity,stock_managed,active,images FROM products WHERE id=${requested.id} LIMIT 1`;
      const product = rows[0] || PRODUCTOS[requested.id];
      if (!product) return res.status(400).json({ error: `Producto no válido: ${requested.id}.` });
      if (product.active === false) return res.status(409).json({ error: `El producto ${product.title} ya no está disponible.` });
      const price = Number(product.price);
      if (!Number.isFinite(price) || price < 0) throw new Error('Precio de producto inválido.');

      let pictureUrl = PRODUCTOS[requested.id]?.picture_url || '';
      const legacyImages = Array.isArray(product.images) ? product.images : [];
      if (legacyImages[0]) pictureUrl = String(legacyImages[0]);
      const uploaded = await sql`SELECT id FROM product_images WHERE product_id=${requested.id} ORDER BY sort_order,id LIMIT 1`;
      if (uploaded.length) pictureUrl = `${origin}/api/product-image?id=${uploaded[0].id}`;

      items.push({
        id: requested.id,
        title: String(product.title),
        description: clean(product.description || PRODUCTOS[requested.id]?.description || 'Figura coleccionable de anime.', 600),
        price,
        qty: requested.qty,
        stockManaged: Boolean(product.stock_managed),
        pictureUrl
      });
    }

    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const units = items.reduce((sum, item) => sum + item.qty, 0);
    const postalCode = normalizePostalCode(customer.postal_code);
    const provinceCode = normalizeProvinceCode(customer.province_code);
    let shipping = null;

    if (shippingEnabled()) {
      shippingQuoteId = clean(body.shipping_quote_id, 80);
      if (!shippingQuoteId) return res.status(409).json({ code: 'SHIPPING_QUOTE_REQUIRED', error: 'Calculá y seleccioná un envío antes de continuar.' });
      if (!postalCode || !provinceCode) return res.status(400).json({ error: 'Completá provincia y código postal para validar el envío.' });

      const quotes = await sql`
        SELECT id,provider,cart_hash,destination_postal_code,destination_province,
               carrier_id,carrier_name,service_code,service_name,dispatch_mode,
               amount,currency,estimated_hours,expires_at,used_at
        FROM shipping_quotes WHERE id=${shippingQuoteId} LIMIT 1
      `;
      const quote = quotes[0];
      const valid = quote && !quote.used_at && new Date(quote.expires_at).getTime() > Date.now()
        && quote.cart_hash === cartHash(normalizedItems)
        && quote.destination_postal_code === postalCode
        && quote.destination_province === provinceCode
        && quote.currency === 'ARS';
      if (!valid) return res.status(409).json({ code: 'SHIPPING_QUOTE_EXPIRED', error: 'La cotización venció o cambió el carrito. Calculá el envío nuevamente.' });
      shipping = { ...quote, amount: Number(quote.amount) };
      if (!Number.isFinite(shipping.amount) || shipping.amount < 0) throw new Error('Costo de envío inválido.');
    }

    const shippingAmount = shipping ? shipping.amount : 0;
    const total = subtotal + shippingAmount;
    const summary = items.length === 1 ? items[0].title : `${items.length} productos: ${items.map(item => `${item.title} x${item.qty}`).join(' · ')}`;
    const provinceName = clean(customer.province_name, 100) || provinceCode || null;

    const customerRows = await sql`
      INSERT INTO customers(name,email,phone,address,city,province,postal_code)
      VALUES(${clean(customer.name, 120) || 'Cliente'},${email},${clean(customer.phone, 50) || null},${clean(customer.address, 200) || null},${clean(customer.city, 100) || null},${provinceName},${postalCode || null})
      ON CONFLICT(email) DO UPDATE SET
        name=EXCLUDED.name,
        phone=COALESCE(EXCLUDED.phone,customers.phone),
        address=COALESCE(EXCLUDED.address,customers.address),
        city=COALESCE(EXCLUDED.city,customers.city),
        province=COALESCE(EXCLUDED.province,customers.province),
        postal_code=COALESCE(EXCLUDED.postal_code,customers.postal_code)
      RETURNING id
    `;
    const customerId = customerRows[0].id;
    const first = items[0];
    const temporaryReference = `MITITOYS-PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const orderRows = await sql`
      INSERT INTO orders(
        order_number,customer_id,product_id,product_title,quantity,unit_price,
        subtotal_amount,shipping_amount,total_amount,external_reference,
        shipping_recipient,shipping_address,shipping_city,shipping_postal_code,
        shipping_province,shipping_phone,shipping_notes,shipping_provider,
        shipping_carrier_id,shipping_carrier,shipping_service,
        shipping_estimated_hours,shipping_quote_id
      ) VALUES(
        'MT-'||TO_CHAR(NOW(),'YYYYMMDDHH24MISSMS')||'-'||SUBSTRING(MD5(RANDOM()::text),1,6),
        ${customerId},${first.id},${summary},${units},${first.price},
        ${subtotal},${shippingAmount},${total},${temporaryReference},
        ${clean(customer.name, 160) || 'Cliente'},${clean(customer.address, 220) || null},${clean(customer.city, 100) || null},${postalCode || null},
        ${provinceName},${clean(customer.phone, 50) || null},${clean(customer.notes, 1000) || null},${shipping?.provider || null},
        ${shipping?.carrier_id || null},${shipping?.carrier_name || null},${shipping?.service_name || null},
        ${shipping?.estimated_hours || null},${shippingQuoteId || null}
      ) RETURNING id,order_number
    `;
    orderId = orderRows[0].id;
    const orderNumber = orderRows[0].order_number;
    const externalReference = `MITITOYS-ORDER-${orderId}`;
    await sql`UPDATE orders SET external_reference=${externalReference} WHERE id=${orderId}`;

    if (shippingQuoteId) {
      const claimed = await sql`UPDATE shipping_quotes SET used_at=NOW(),order_id=${orderId} WHERE id=${shippingQuoteId} AND used_at IS NULL AND expires_at>NOW() RETURNING id`;
      if (!claimed.length) throw Object.assign(new Error('La cotización ya fue utilizada o venció.'), { code: 'SHIPPING_QUOTE_EXPIRED' });
    }

    for (const item of items) {
      await sql`INSERT INTO order_items(order_id,product_id,product_title,quantity,unit_price,total_amount) VALUES(${orderId},${item.id},${item.title},${item.qty},${item.price},${item.price * item.qty})`;
    }

    for (const item of items) {
      if (!item.stockManaged) continue;
      const update = await sql`UPDATE products SET stock_quantity=stock_quantity-${item.qty},updated_at=NOW() WHERE id=${item.id} AND stock_quantity>=${item.qty} RETURNING stock_quantity`;
      if (!update.length) throw new Error(`Sin stock disponible para ${item.title}.`);
      reserved.push(item);
      await sql`INSERT INTO inventory_movements(product_id,order_id,movement_type,quantity,reason) VALUES(${item.id},${orderId},'reserve',${-item.qty},'Reserva automática al iniciar una compra')`;
    }

    const preferenceItems = items.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      picture_url: item.pictureUrl,
      quantity: item.qty,
      currency_id: 'ARS',
      unit_price: item.price
    }));
    if (shipping) {
      preferenceItems.push({
        id: `ENVIO-${shipping.carrier_id}`,
        title: `Envío a domicilio · ${shipping.carrier_name}`,
        description: shipping.service_name || 'Servicio de envío',
        quantity: 1,
        currency_id: 'ARS',
        unit_price: shippingAmount
      });
    }

    const preference = {
      items: preferenceItems,
      payer: { name: clean(customer.name, 120), email },
      external_reference: externalReference,
      back_urls: {
        success: `${origin}/pedido.html?pedido=${encodeURIComponent(orderNumber)}&pago=exitoso`,
        pending: `${origin}/pedido.html?pedido=${encodeURIComponent(orderNumber)}&pago=pendiente`,
        failure: `${origin}/pedido.html?pedido=${encodeURIComponent(orderNumber)}&pago=fallido`
      },
      auto_return: 'approved',
      statement_descriptor: 'MITITOYS'
    };

    const mercadoPagoResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
      body: JSON.stringify(preference)
    });
    const mercadoPago = await mercadoPagoResponse.json().catch(() => ({}));
    if (!mercadoPagoResponse.ok || !mercadoPago.init_point) throw new Error('Mercado Pago rechazó la creación del pago.');

    await sql`UPDATE orders SET preference_id=${mercadoPago.id} WHERE id=${orderId}`;
    await sql`
      INSERT INTO order_events(order_id,event_type,new_status,payload)
      VALUES(${orderId},'order.created','pending',${JSON.stringify({
        preference_id: mercadoPago.id,
        multi_product: true,
        subtotal,
        shipping: shipping ? { quote_id: shippingQuoteId, carrier: shipping.carrier_name, service: shipping.service_name, amount: shippingAmount, estimated_hours: shipping.estimated_hours } : null,
        items: items.map(item => ({ product_id: item.id, quantity: item.qty, unit_price: item.price })),
        stock_reserved: reserved.map(item => ({ product_id: item.id, quantity: item.qty }))
      })})
    `;
    return res.status(200).json({ init_point: mercadoPago.init_point, preference_id: mercadoPago.id, order_number: orderNumber, subtotal, shipping_amount: shippingAmount, total });
  } catch (error) {
    console.error('crear-preferencia-carrito error:', error);
    if (sql && orderId) {
      try { await sql`UPDATE orders SET status='cancelled',updated_at=NOW() WHERE id=${orderId}`; } catch (_) {}
      await releaseReservedStock(sql, orderId, reserved, 'Liberación por error al crear el pago');
      if (shippingQuoteId) {
        try { await sql`UPDATE shipping_quotes SET used_at=NULL,order_id=NULL WHERE id=${shippingQuoteId} AND order_id=${orderId}`; } catch (_) {}
      }
    }
    if (String(error?.message || '').startsWith('Sin stock disponible')) return res.status(409).json({ error: error.message });
    if (error?.code === 'SHIPPING_QUOTE_EXPIRED') return res.status(409).json({ code: error.code, error: error.message });
    return res.status(500).json({ error: 'No se pudo crear el pago.' });
  }
};
