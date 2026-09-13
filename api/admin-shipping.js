const { getDb } = require('../lib/db');
const { verify } = require('./admin-auth');

const SHIPPING_FIELDS = ['weight_kg', 'package_length_cm', 'package_width_cm', 'package_height_cm'];
const ALLOWED_FIELDS = new Set(['id', 'updated_at', ...SHIPPING_FIELDS]);

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function validVersion(value) {
  const version = clean(value, 80);
  return version && Number.isFinite(Date.parse(version)) ? version : '';
}

function parseShipping(body) {
  const values = {};
  for (const key of SHIPPING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return null;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value <= 0) return null;
    values[key] = value;
  }
  return values;
}

module.exports = async (req, res) => {
  if (!verify(req)) return res.status(401).json({ error: 'No autorizado.' });
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Método no permitido.' });

  const body = req.body || {};
  const id = clean(body.id, 50);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'COD de producto inválido.' });
  }

  const unexpected = Object.keys(body).filter(key => !ALLOWED_FIELDS.has(key));
  if (unexpected.length) {
    return res.status(400).json({ error: 'La actualización de envíos solo acepta peso y dimensiones.' });
  }

  const expectedVersion = validVersion(body.updated_at);
  if (!expectedVersion) {
    return res.status(409).json({ error: 'La versión del producto está desactualizada. Actualizá el panel antes de guardar.' });
  }

  const shipping = parseShipping(body);
  if (!shipping) {
    return res.status(400).json({ error: 'Completá peso, largo, ancho y alto con valores mayores a cero.' });
  }

  const sql = getDb();
  try {
    const rows = await sql`
      UPDATE products
      SET weight_kg=${shipping.weight_kg},
          package_length_cm=${shipping.package_length_cm},
          package_width_cm=${shipping.package_width_cm},
          package_height_cm=${shipping.package_height_cm},
          updated_at=NOW()
      WHERE id=${id}
        AND date_trunc('milliseconds',updated_at)=date_trunc('milliseconds',${expectedVersion}::timestamptz)
      RETURNING id,title,description,images,price,stock_quantity,stock_managed,active,
                weight_kg,package_length_cm,package_width_cm,package_height_cm,updated_at
    `;
    if (!rows.length) return res.status(409).json({ error: 'El producto cambió desde que abriste esta pantalla. Actualizá antes de guardar para no sobrescribir datos nuevos.' });
    return res.status(200).json({ product: rows[0] });
  } catch (error) {
    console.error('admin shipping error:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'No se pudieron guardar los datos de envío.' });
  }
};