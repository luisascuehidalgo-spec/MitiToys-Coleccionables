const { getDb } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });
  try {
    const sql = getDb();
    const products = await sql`SELECT id,title,description,images,price,stock_quantity,stock_managed,active,created_at,updated_at FROM products WHERE active=true ORDER BY title ASC`;
    const uploaded = await sql`SELECT id,product_id,sort_order FROM product_images ORDER BY product_id,sort_order,id`;
    const byProduct = new Map();
    for (const image of uploaded) {
      if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, []);
      byProduct.get(image.product_id).push({ id: image.id, url: `/api/product-image?id=${image.id}`, sort_order: image.sort_order });
    }
    const result = products.map(p => {
      const legacy = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
      const stored = byProduct.get(p.id) || [];
      const images = [...legacy, ...stored.map(x => x.url)].slice(0, 8);
      return { ...p, images };
    });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({ products: result });
  } catch (error) {
    console.error('products api error:', error);
    return res.status(500).json({ error: 'No se pudieron cargar los productos.' });
  }
};
