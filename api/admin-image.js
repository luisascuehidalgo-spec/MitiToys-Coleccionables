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

    if (req.method === 'DELETE') {
      return res.status(410).json({ error: 'La eliminación binaria antigua ya no está disponible. Guardá las URLs actuales del producto desde el panel.' });
    }

    if (req.method === 'POST') {
      const sql = getDb();
      const productId = clean(query.get('productId'), 50);
      const mime = clean(req.headers['content-type'], 100).split(';')[0].toLowerCase();
      const filename = clean(req.headers['x-filename'], 180) || 'imagen';
      if (!productId) return res.status(400).json({ error: 'Falta el producto.' });
      if (!ALLOWED.has(mime)) return res.status(400).json({ error: 'Formato no permitido. Usá JPG, PNG o WEBP.' });
      configuration();

      const products = await sql`
        SELECT id,COALESCE(jsonb_array_length(images),0)::int AS image_count
        FROM products WHERE id=${productId} LIMIT 1
      `;
      if (!products.length) return res.status(404).json({ error: 'Producto no encontrado.' });
      if (Number(products[0].image_count || 0) >= 8) return res.status(400).json({ error: 'Este producto ya tiene el máximo de 8 fotos.' });

      const body = await readBody(req);
      if (!body.length) return res.status(400).json({ error: 'La imagen está vacía.' });
      const matches = mime === 'image/jpeg' ? body.subarray(0,3).equals(Buffer.from([255,216,255]))
        : mime === 'image/png' ? body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : body.toString('ascii',0,4) === 'RIFF' && body.toString('ascii',8,12) === 'WEBP';
      if (!matches) return res.status(400).json({ error: 'El contenido no corresponde a una imagen JPG, PNG o WEBP.' });

      const url = await uploadImage(body, mime);
      const rows = await sql`
        UPDATE products
        SET images=COALESCE(images,'[]'::jsonb) || ${JSON.stringify([url])}::jsonb,updated_at=NOW()
        WHERE id=${productId} AND COALESCE(jsonb_array_length(images),0) < 8
        RETURNING id
      `;
      if (!rows.length) return res.status(409).json({ error: 'El producto cambió o ya tiene 8 fotos. Actualizá el panel.' });
      return res.status(201).json({ image: { url, filename, mime_type: mime } });
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
