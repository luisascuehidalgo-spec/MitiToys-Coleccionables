const crypto = require('crypto');
const { getDb } = require('../lib/db');
const {
  shippingEnabled,
  normalizePostalCode,
  normalizeProvinceCode,
  normalizeCart,
  cartHash,
  buildPackages,
  quoteEnviopack
} = require('../lib/shipping');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  if (!shippingEnabled()) return res.status(503).json({ code: 'SHIPPING_NOT_CONFIGURED', error: 'La cotización automática todavía no está habilitada.' });

  try {
    const items = normalizeCart(req.body?.items);
    const postalCode = normalizePostalCode(req.body?.postal_code);
    const provinceCode = normalizeProvinceCode(req.body?.province_code);
    if (!items.length) return res.status(400).json({ error: 'El carrito está vacío.' });
    if (!postalCode) return res.status(400).json({ error: 'Ingresá un código postal argentino de 4 dígitos.' });
    if (!provinceCode) return res.status(400).json({ error: 'Seleccioná la provincia de destino.' });

    const sql = getDb();
    const products = [];
    for (const item of items) {
      const rows = await sql`
        SELECT id,title,active,weight_kg,package_length_cm,package_width_cm,package_height_cm
        FROM products WHERE id=${item.id} LIMIT 1
      `;
      if (!rows.length || rows[0].active === false) return res.status(409).json({ error: `El producto COD ${item.id} ya no está disponible.` });
      products.push(rows[0]);
    }

    const { packages, missing } = buildPackages(products, items);
    if (missing.length) {
      return res.status(422).json({
        code: 'PRODUCT_SHIPPING_DATA_MISSING',
        error: 'Faltan peso o medidas de envío en uno o más productos.',
        products: missing
      });
    }

    const rates = await quoteEnviopack({ provinceCode, postalCode, packages });
    const fingerprint = cartHash(items);
    const packageDetails = JSON.stringify(packages);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const options = [];
    for (const rate of rates) {
      const id = crypto.randomUUID();
      await sql`
        INSERT INTO shipping_quotes(
          id,provider,cart_hash,destination_postal_code,destination_province,
          carrier_id,carrier_name,service_code,service_name,dispatch_mode,
          amount,currency,estimated_hours,package_details,expires_at
        ) VALUES(
          ${id},'enviopack',${fingerprint},${postalCode},${provinceCode},
          ${rate.carrierId},${rate.carrierName},${rate.serviceCode},${rate.serviceName},${rate.dispatchMode || null},
          ${rate.amount},'ARS',${rate.estimatedHours},${packageDetails}::jsonb,${expiresAt.toISOString()}
        )
      `;
      options.push({
        quote_id: id,
        carrier_id: rate.carrierId,
        carrier_name: rate.carrierName,
        service_code: rate.serviceCode,
        service_name: rate.serviceName,
        amount: rate.amount,
        currency: 'ARS',
        estimated_hours: rate.estimatedHours,
        estimated_days: rate.estimatedHours ? Math.max(1, Math.ceil(rate.estimatedHours / 24)) : null,
        recommended: options.length === 0
      });
    }

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({ postal_code: postalCode, province_code: provinceCode, expires_at: expiresAt.toISOString(), options });
  } catch (error) {
    console.error('cotizar-envio error:', error);
    const status = error?.code === 'NO_SHIPPING_RATES' ? 404 : error?.code === 'DESTINATION_MISMATCH' ? 400 : error?.code === 'SHIPPING_NOT_CONFIGURED' ? 503 : 502;
    return res.status(status).json({ code: error?.code || 'SHIPPING_QUOTE_ERROR', error: error?.message || 'No se pudo calcular el envío.' });
  }
};
