const { getDb } = require('../lib/db');
const { verify } = require('./admin-auth');

module.exports.config = { api: { bodyParser: false } };

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        reject(new Error('IMAGE_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (!verify(req)) return res.status(401).json({ error: 'No autorizado.' });
  const sql = getDb();
  try {
    if (req.method === 'POST') {
      const productId = clean(req.query?.productId, 50);
      const mime = clean(req.headers['content-type'], 100).split(';')[0].toLowerCase();
      const filename = clean(req.headers['x-filename'], 180) || 'imagen';
      if (!productId) return res.status(400).json({ error: 'Falta el producto.' });
      if (!ALLOWED.has(mime)) return res.status(400).json({ error: 'Formato no permitido. Usá JPG, PNG o WEBP.' });
      const product = await sql`SELECT id FROM products WHERE id=${productId}`;
      if (!product.length) return res.status(404).json({ error: 'Producto no encontrado.' });
      const counts = await sql`SELECT (SELECT COUNT(*) FROM product_images WHERE product_id=${productId})::int AS uploaded_count, (SELECT COUNT(*) FROM products WHERE id=${productId} AND jsonb_typeof(images)='array')::int AS legacy_holder`;
      const legacy = await sql`SELECT COALESCE(jsonb_array_length(images),0)::int AS count FROM products WHERE id=${productId}`;
      const uploadedCount = Number(counts[0]?.uploaded_count || 0);
      const legacyCount = Number(legacy[0]?.count || 0);
      if (uploadedCount + legacyCount >= 8) return res.status(400).json({ error: 'Este producto ya tiene el máximo de 8 fotos.' });
      const body = await readBody(req);
      if (!body.length) return res.status(400).json({ error: 'La imagen está vacía.' });
      const rows = await sql`INSERT INTO product_images(product_id,filename,mime_type,image_data,sort_order) VALUES(${productId},${filename},${mime},${body},${uploadedCount}) RETURNING id,product_id,filename,mime_type,sort_order,created_at`;
      const image = rows[0];
      return res.status(201).json({ image: { id: image.id, url: `/api/product-image?id=${image.id}`, filename: image.filename, mime_type: image.mime_type, sort_order: image.sort_order } });
    }
    if (req.method === 'DELETE') {
      const id = Number(req.query?.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Imagen inválida.' });
      await sql`DELETE FROM product_images WHERE id=${id}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (error) {
    console.error('admin image error:', error);
    if (error.message === 'IMAGE_TOO_LARGE') return res.status(413).json({ error: 'La imagen supera 4 MB.' });
    return res.status(500).json({ error: 'No se pudo guardar la imagen.' });
  }
};
