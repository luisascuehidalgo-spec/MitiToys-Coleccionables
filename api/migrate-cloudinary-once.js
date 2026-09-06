const { createHash, timingSafeEqual } = require('node:crypto');
const { getDb } = require('../lib/db');
const { configuration, uploadImage } = require('../lib/cloudinary');

const TOKEN_HASH = '67dce70e1acd6603e0de5265dbf3e31ba2690c631beab0aa749aa8cf50e13db7';
const PLAN = new Map([
  ['4444', [53, 54, 55]],
  ['3725', [45, 46, 47, 48, 49]],
  ['3436', [32, 33, 34, 35]],
  ['2264', [50, 51, 52]],
  ['4649', [38, 39, 40, 41, 42, 43, 44]],
  ['3376', [36, 37]],
]);

function authorized(token) {
  const actual = createHash('sha256').update(String(token || '')).digest('hex');
  const a = Buffer.from(actual);
  const b = Buffer.from(TOKEN_HASH);
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });
  if (!authorized(req.query?.token)) return res.status(404).end();

  const productId = String(req.query?.product || '').trim();
  const expectedIds = PLAN.get(productId);
  if (!expectedIds) return res.status(400).json({ error: 'Producto fuera del plan.' });

  try {
    configuration();
    const sql = getDb();
    const product = await sql`SELECT id, COALESCE(jsonb_array_length(images),0)::int AS legacy_count FROM products WHERE id=${productId} LIMIT 1`;
    if (!product.length) return res.status(404).json({ error: 'Producto no encontrado.' });

    const rows = await sql`
      SELECT id, product_id, sort_order, mime_type, image_data
      FROM product_images
      WHERE product_id=${productId}
      ORDER BY sort_order, id
    `;
    const selected = rows.filter(row => expectedIds.includes(Number(row.id)));

    if (!selected.length) {
      return res.status(200).json({ ok: true, product: productId, migrated: 0, already_done: true });
    }
    const foundIds = selected.map(row => Number(row.id));
    if (selected.length !== expectedIds.length || expectedIds.some(id => !foundIds.includes(id))) {
      return res.status(409).json({ error: 'El conjunto de imágenes cambió; migración cancelada.', found: foundIds });
    }
    if (Number(product[0].legacy_count || 0) + selected.length > 8) {
      return res.status(409).json({ error: 'La migración superaría el máximo de 8 imágenes.' });
    }

    const uploads = [];
    for (const row of selected) {
      const url = await uploadImage(row.image_data, row.mime_type);
      uploads.push({ id: Number(row.id), url });
    }

    const urls = uploads.map(item => item.url);
    const ids = uploads.map(item => item.id);
    const deleted = await sql`
      WITH updated AS (
        UPDATE products
        SET images = COALESCE(images, '[]'::jsonb) || ${JSON.stringify(urls)}::jsonb,
            updated_at = NOW()
        WHERE id=${productId}
        RETURNING id
      )
      DELETE FROM product_images
      WHERE product_id=${productId}
        AND id = ANY(${ids}::int[])
        AND EXISTS (SELECT 1 FROM updated)
      RETURNING id
    `;

    if (deleted.length !== ids.length) {
      return res.status(500).json({ error: 'La base no confirmó toda la migración.' });
    }

    return res.status(200).json({ ok: true, product: productId, migrated: urls.length, urls });
  } catch (error) {
    console.error('cloudinary migration error:', error?.status || error?.message || error);
    return res.status(error?.status || 500).json({ error: error?.message || 'No se pudo completar la migración.' });
  }
};
