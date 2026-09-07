const { getDb } = require('../lib/db');
const { verify } = require('./admin-auth');
const { searchParams } = require('../lib/request-url');
const { configuration, uploadImage } = require('../lib/cloudinary');

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
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  const query = searchParams(req);
  if (!verify(req)) return res.status(401).json({ error: 'No autorizado.' });
  try {
    if (req.method === 'GET') {
      configuration();
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ ready: true });
    }
    const sql = getDb();
    if (req.method === 'POST') {
      const productId = clean(query.get('productId'), 50);
      const mime = clean(req.headers['content-type'], 100).split(';')[0].toLowerCase();
      const filename = clean(req.headers['x-filename'], 180) || 'imagen';
      if (!productId) return res.status(400).json({ error: 'Falta el producto.' });
      if (!ALLOWED.has(mime)) return res.status(400).json({ error: 'Formato no permitido. Usá JPG, PNG o WEBP.' });
      configuration();
      const product = await sql`SELECT id FROM products WHERE id=${productId}`;
      if (!product.length) return res.status(404).json({ error: 'Producto no encontrado.' });
      const counts = await sql`SELECT (SELECT COUNT(*) FROM product_images WHERE product_id=${productId})::int AS uploaded_count, (SELECT COUNT(*) FROM products WHERE id=${productId} AND jsonb_typeof(images)='array')::int AS legacy_holder`;
      const legacy = await sql`SELECT COALESCE(jsonb_array_length(images),0)::int AS count FROM products WHERE id=${productId}`;
      const uploadedCount = Number(counts[0]?.uploaded_count || 0);
      const legacyCount = Number(legacy[0]?.count || 0);
      if (uploadedCount + legacyCount >= 8) return res.status(400).json({ error: 'Este producto ya tiene el máximo de 8 fotos.' });
      const body = await readBody(req);
      if (!body.length) return res.status(400).json({ error: 'La imagen está vacía.' });
      const matches = mime === 'image/jpeg' ? body.subarray(0,3).equals(Buffer.from([255,216,255]))
        : mime === 'image/png' ? body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : body.toString('ascii',0,4) === 'RIFF' && body.toString('ascii',8,12) === 'WEBP';
      if (!matches) return res.status(400).json({ error: 'El contenido no corresponde a una imagen JPG, PNG o WEBP.' });
      const url = await uploadImage(body, mime);
      // Atomic append preserves existing URLs and rechecks the limit after upload.
      // The binary table is read only for counting old photos; new bytes never enter Neon.
      const rows = await sql`
        UPDATE products SET images=COALESCE(images,'[]'::jsonb) || ${JSON.stringify([url])}::jsonb,updated_at=NOW()
        WHERE id=${productId} AND COALESCE(jsonb_array_length(images),0) +
          (SELECT COUNT(*) FROM product_images WHERE product_id=${productId}) < 8
        RETURNING id
      `;
      if (!rows.length) return res.status(409).json({ error: 'El producto cambió o ya tiene 8 fotos. Actualizá el panel.' });
      return res.status(201).json({ image: { url, filename, mime_type: mime } });
    }
    if (req.method === 'DELETE') {
      const id = Number(query.get('id'));
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Imagen inválida.' });
      await sql`DELETE FROM product_images WHERE id=${id}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (error) {
    console.error('admin image error:', error.status || 'UPLOAD_FAILED');
    if (error.message === 'IMAGE_TOO_LARGE') return res.status(413).json({ error: 'La imagen supera 4 MB.' });
    if (error.status) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'No se pudo guardar la imagen. Actualizá el panel antes de reintentar.' });
  }
};

module.exports.config = { api: { bodyParser: false } };
