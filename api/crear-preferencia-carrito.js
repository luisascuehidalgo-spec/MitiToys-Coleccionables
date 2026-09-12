const { getDb } = require('../lib/db');
const {
  shippingEnabled,
  normalizePostalCode,
  normalizeProvinceCode,
  normalizeCart,
  cartHash
} = require('../lib/shipping');
const { allocateOrderId, persistCheckoutLocal, cleanupCheckoutLocal } = require('../lib/checkout-persistence');
const { PUBLIC_BASE_URL, preferenceWindow, createPreferenceWithReconciliation } = require('../lib/payments');
const { persistPreferenceIdentity } = require('../lib/external-identities');

const clean = (value, max = 200) => String(value || '').trim().slice(0, max);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) return res.status(500).json({ error: 'Falta configurar Mercado Pago.' });

  let sql = null;
  let orderId = null;
  let shippingQuoteId = null;
  let localCheckoutPersisted = false;
  const reserved = [];

  try {
    const body = req.body || {};
    const normalizedItems = normalizeCart(body.items);
    if (!normalizedItems.length) return res.status(400).json({ error: 'El carrito está vacío.' });

    const customer = body.customer || {};
    const email = clean(customer.email, 160).toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ingresá un email válido para continuar.' });

    const origin = PUBLIC_BASE_URL;
    sql = getDb();
    const items = [];

    for (const requested of normalizedItems) {
      const rows = await sql`SELECT id,title,description,price,stock_quantity,stock_managed,active,images FROM products WHERE id=${requested.id} LIMIT 1`;
      const product = rows[0];
      if (!product) return res.status(400).json({ error: `Producto no válido: ${requested.id}.` });
      if (product.active === false) return res.status(409).json({ error: `El producto ${product.title} ya no está disponible.` });
      const price = Number(product.price);
      if (!Number.isFinite(price) || price < 0) throw new Error('Precio de producto inválido.');

      let pictureUrl = '';
      const productImages = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
      if (productImages[0]) pictureUrl = String(productImages[0]);

      items.push({
        id: requested.id,
        title: String(product.title),
        description: clean(product.description || 'Figura coleccionable de anime.', 600),
        price,
        qty: requested.qty,
        stockManaged: Boolean(product.stock_managed),
        pictureUrl
      });
    }

    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const postalCode = normalizePostalCode(customer.postal_code);
    const provinceCode = normalizeProvinceCode(customer.province_code);
    let shipping = null;

    if (shippingEnabled()) {
      shippingQuoteId = clean(body.shipping_quote_id, 80);
      if (!shippingQuoteId) return res.status(409).json({ code: 'SHIPPING_QUOTE_REQUIRED', error: 'Calculá y seleccioná un envío antes de continuar.' });
      if (!provinceCode) return res.status(400).json({ error: 'Completá la provincia para validar el envío.' });

      const quotes = await sql`
        SELECT id,provider,cart_hash,destination_postal_code,destination_province,
               carrier_id,carrier_name,service_code,service_name,dispatch_mode,
               amount,currency,estimated_hours,expires_at,used_at,
               destination_type,destination_locality_id,destination_locality_name,
               branch_id,branch_name,branch_address,branch_schedule,package_details
        FROM shipping_quotes WHERE id=${shippingQuoteId} LIMIT 1
      `;
      const quote = quotes[0];
      const quoteType = quote?.destination_type === 'branch' ? 'branch' : 'home';
      const valid = quote && !quote.used_at && new Date(quote.expires_at).getTime() > Date.now()
        && quote.cart_hash === cartHash(normalizedItems)
        && quote.destination_province === provinceCode
        && quote.currency === 'ARS'
        && (quoteType === 'branch' ? Boolean(quote.branch_id) : quote.destination_postal_code === postalCode);
      if (!valid) return res.status(409).json({ code: 'SHIPPING_QUOTE_EXPIRED', error: 'La cotización venció o cambió el carrito. Calculá el envío nuevamente.' });
      shipping = { ...quote, amount: Number(quote.amount), destination_type: quoteType };
      if (!Number.isFinite(shipping.amount) || shipping.amount < 0) throw new Error('Costo de envío inválido.');
    }

    const shippingAmount = shipping ? shipping.amount : 0;
    const total = subtotal + shippingAmount;
    const summary = items.length === 1 ? items[0].title : `${items.length} productos: ${items.map(item => `${item.title} x${item.qty}`).join(' · ')}`;
    const provinceName = clean(customer.province_name, 100) || provinceCode || null;
    const finalPostalCode = shipping?.destination_postal_code || postalCode || null;
    const street = clean(customer.street, 120);
    const streetNumber = clean(customer.street_number, 10);
    const floor = clean(customer.floor, 10);
    const unit = clean(customer.unit, 10);
    const homeAddress = [street, streetNumber, floor ? 'Piso ' + floor : '', unit ? 'Depto ' + unit : ''].filter(Boolean).join(' ');
    const deliveryAddress = shipping?.destination_type === 'branch' ? clean(shipping.branch_address, 220) : (homeAddress || clean(customer.address, 220));
    const deliveryCity = shipping?.destination_type === 'branch' ? clean(shipping.destination_locality_name, 100) : clean(customer.city, 100);

    const customerRows = await sql`
      INSERT INTO customers(name,email,phone,address,city,province,postal_code)
      VALUES(${clean(customer.name, 120) || 'Cliente'},${email},${clean(customer.phone, 50) || null},${deliveryAddress || null},${deliveryCity || null},${provinceName},${finalPostalCode})
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

    orderId = await allocateOrderId(sql);
    const localCheckout = await persistCheckoutLocal(sql, {
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
    });
    localCheckoutPersisted = true;
    const orderNumber = localCheckout.orderNumber;
    const externalReference = localCheckout.externalReference;
    reserved.push(...localCheckout.reserved);

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
        title: `${shipping.destination_type === 'branch' ? 'Retiro en sucursal' : 'Envío a domicilio'} · ${shipping.carrier_name}`,
        description: shipping.destination_type === 'branch' ? `${shipping.branch_name || 'Sucursal'} · ${shipping.branch_address || ''}` : (shipping.service_name || 'Servicio de envío'),
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
      statement_descriptor: 'MITITOYS',
      ...preferenceWindow()
    };

    let mercadoPago;
    try {
      mercadoPago = await createPreferenceWithReconciliation(preference, externalReference);
    } catch (preferenceError) {
      if (preferenceError?.code !== 'MP_PREFERENCE_UNCERTAIN') throw preferenceError;
      try { await sql`UPDATE orders SET payment_status_detail='preference_uncertain',updated_at=NOW() WHERE id=${orderId}`; } catch (_) {}
      try {
        await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${orderId},'payment.preference_uncertain','pending',${JSON.stringify({ external_reference: externalReference })}::jsonb)`;
      } catch (_) {}
      return res.status(202).json({
        init_point: `${origin}/pedido.html?pedido=${encodeURIComponent(orderNumber)}&pago=verificando`,
        pending_confirmation: true,
        order_number: orderNumber,
        subtotal,
        shipping_amount: shippingAmount,
        total
      });
    }

    const preferenceIdentity = await persistPreferenceIdentity(sql, { orderId, preferenceId: mercadoPago.id, paymentUrl: mercadoPago.init_point });
    if (!preferenceIdentity.ok) {
      await sql`UPDATE orders SET payment_status_detail='preference_ownership_conflict',updated_at=NOW() WHERE id=${orderId}`;
      await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${orderId},'payment.preference_ownership_conflict','pending',${JSON.stringify({ preference_id: mercadoPago.id, conflict_order_id: preferenceIdentity.conflictOrderId || null })}::jsonb)`;
      return res.status(202).json({
        init_point: `${origin}/pedido.html?pedido=${encodeURIComponent(orderNumber)}&pago=verificando`,
        pending_confirmation: true,
        order_number: orderNumber,
        subtotal,
        shipping_amount: shippingAmount,
        total
      });
    }
    await sql`
      INSERT INTO order_events(order_id,event_type,new_status,payload)
      VALUES(${orderId},'order.created','pending',${JSON.stringify({
        preference_id: mercadoPago.id,
        preference_recovered: mercadoPago.recovered === true,
        multi_product: true,
        subtotal,
        shipping: shipping ? { quote_id: shippingQuoteId, type: shipping.destination_type, carrier: shipping.carrier_name, service: shipping.service_name, amount: shippingAmount, estimated_hours: shipping.estimated_hours, branch: shipping.branch_name || null } : null,
        items: items.map(item => ({ product_id: item.id, quantity: item.qty, unit_price: item.price })),
        stock_reserved: reserved.map(item => ({ product_id: item.id, quantity: item.qty }))
      })})
    `;
    return res.status(200).json({ init_point: mercadoPago.init_point, preference_id: mercadoPago.id, order_number: orderNumber, subtotal, shipping_amount: shippingAmount, total });
  } catch (error) {
    console.error('crear-preferencia-carrito error:', 'code=' + String(error?.code || error?.name || 'CHECKOUT_ERROR'), 'status=' + String(error?.providerStatus || error?.status || 'unknown'));
    if (sql && orderId && localCheckoutPersisted) {
      try {
        const cleanup = await cleanupCheckoutLocal(sql, { orderId });
        if (!cleanup.cleaned) console.warn('checkout cleanup skipped:', 'code=CHECKOUT_CLEANUP_STATE_CHANGED');
      } catch (cleanupError) {
        console.warn('checkout cleanup failed:', 'code=' + String(cleanupError?.code || cleanupError?.name || 'CHECKOUT_CLEANUP_FAILED'));
      }
    }
    if (String(error?.message || '').startsWith('Sin stock disponible')) return res.status(409).json({ error: error.message });
    if (error?.code === 'SHIPPING_QUOTE_EXPIRED') return res.status(409).json({ code: error.code, error: error.message });
    if (error?.code === 'CHECKOUT_LOCAL_INTEGRITY_FAILED') {
      return res.status(409).json({
        code: error.code,
        error: 'El stock o la cotización cambiaron mientras confirmábamos el pedido. Revisá el carrito y calculá el envío nuevamente.'
      });
    }
    return res.status(500).json({ error: 'No se pudo crear el pago.' });
  }
};
