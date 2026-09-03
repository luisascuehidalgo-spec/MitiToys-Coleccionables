const { getDb } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();
  const id = Number(req.query?.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).end();
  try {
    const sql = getDb();
    const rows = await sql`SELECT mime_type, image_data FROM product_images WHERE id=${id} LIMIT 1`;
    if (!rows.length) return res.status(404).end();
    res.setHeader('Content-Type', rows[0].mime_type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', 'inline');
    return res.status(200).send(rows[0].image_data);
  } catch (error) {
    console.error('product image error:', error);
    return res.status(500).end();
  }
};
