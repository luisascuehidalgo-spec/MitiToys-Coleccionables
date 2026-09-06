const { getDb } = require('../lib/db');
const { configuration, uploadImage } = require('../lib/cloudinary');

const PLAN = new Map([
  ['4444', [53, 54, 55]],
  ['3725', [45, 46, 47, 48, 49]],
  ['3436', [32, 33, 34, 35]],
  ['2264', [50, 51, 52]],
  ['4649', [38, 39, 40, 41, 42, 43, 44]],
  ['3376', [36, 37]],
]);

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });
  const productId = String(req.query?.product || '').trim();
  const expectedIds = PLAN.get(productId);
  if (!expectedIds) return res.status(400).json({ error: 'Producto fuera del plan de migración.' });

  try {
    configuration();
    const sql = getDb();
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
    if (selected.length !== expectedIds.length) {
      return res.status(409).json({ error: 'El conjunto de imágenes cambió; migración cancelada.' });
    }

    const selectedIds = selected.map(row => Number(row.id));
    if (selectedIds.some((id, index) => id !== expectedIds[index])) {
      return res.status(409).json({ error: 'El orden de imágenes cambió; migración cancelada.' });
    }

    const uploads = [];
    for (const row of selected) {
      const url = await uploadImage(row.image_data, row.mime_type);
      uploads.push({ id: Number(row.id), url });
    }

    const urls = uploads.map(item => item.url);
    const updated = await sql`
      UPDATE products
      SET images = COALESCE(images, '[]'::jsonb) || ${JSON.stringify(urls)}::jsonb,
          updated_at = NOW()
      WHERE id=${productId}
      RETURNING id
    `;
    if (!updated.length) throw new Error('Producto no encontrado durante la migración.');

    for (const item of uploads) {
      await sql`DELETE FROM product_images WHERE id=${item.id} AND product_id=${productId}`;
    }

    return res.status(200).json({
      ok: true,
      product: productId,
      migrated: uploads.length,
      image_ids: uploads.map(item => item.id),
      urls,
    });
  } catch (error) {
    console.error('internal image migration error:', error?.status || error?.message || error);
    return res.status(error?.status || 500).json({ error: error?.message || 'No se pudo completar la migración.' });
  }
};
