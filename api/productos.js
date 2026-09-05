const { getDb } = require('../lib/db');
const clean = (value, max = 500) => String(value || '').trim().slice(0, max);
const escapeXml = value => String(value ?? '').replace(/[<>&'\"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]));

module.exports = async (req, res) => {
  const sql = getDb();
  try {
    if (req.method === 'GET' && req.query?.sitemap) {
      const products = await sql`SELECT id,updated_at FROM products WHERE active=true ORDER BY updated_at DESC`;
      const staticUrls = [
        ['https://mititoys.com/', '1.0'],
        ['https://mititoys.com/preguntas.html', '0.5'],
        ['https://mititoys.com/politicas.html', '0.4'],
        ['https://mititoys.com/seguimiento.html', '0.3']
      ].map(([url, priority]) => `<url><loc>${url}</loc><priority>${priority}</priority></url>`);
      const productUrls = products.map(product => {
        const url = `https://mititoys.com/producto.html?id=${encodeURIComponent(product.id)}`;
        const lastmod = product.updated_at ? new Date(product.updated_at).toISOString() : '';
        return `<url><loc>${escapeXml(url)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>0.8</priority></url>`;
      });
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...staticUrls, ...productUrls].join('')}</urlset>`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).send(xml);
    }

    if (req.method === 'GET' && req.query?.review_token) {
      const token = clean(req.query.review_token, 80);
      const rows = await sql`
        SELECT r.product_id,r.status,r.rating,r.title,r.body,p.title AS product_title,
          COALESCE((SELECT url FROM jsonb_array_elements_text(p.images) url LIMIT 1),'') AS legacy_image,
          o.order_number,c.name AS customer_name
        FROM reviews r JOIN products p ON p.id=r.product_id
        JOIN orders o ON o.id=r.order_id LEFT JOIN customers c ON c.id=r.customer_id
        WHERE r.review_token=${token} AND o.status='delivered' LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: 'Este enlace de opinión no es válido o el pedido todavía no fue entregado.' });
      const image = await sql`SELECT id FROM product_images WHERE product_id=${rows[0].product_id} ORDER BY sort_order,id LIMIT 1`;
      return res.status(200).json({ review: { ...rows[0], image: image.length ? '/api/product-image?id=' + image[0].id : rows[0].legacy_image } });
    }

    if (req.method === 'POST') {
      const token = clean(req.body?.token, 80);
      const rating = Number(req.body?.rating);
      const title = clean(req.body?.title, 120);
      const body = clean(req.body?.body, 2000);
      if (!token || !Number.isInteger(rating) || rating < 1 || rating > 5 || body.length < 10) return res.status(400).json({ error: 'Elegí de 1 a 5 estrellas y escribí al menos 10 caracteres.' });
      const rows = await sql`
        UPDATE reviews r SET rating=${rating},title=${title || null},body=${body},
          status='published',submitted_at=NOW(),published_at=NOW()
        FROM orders o
        WHERE r.order_id=o.id AND r.review_token=${token} AND o.status='delivered'
        RETURNING r.id,r.product_id,r.rating,r.status
      `;
      if (!rows.length) return res.status(404).json({ error: 'Este enlace de opinión no es válido.' });
      return res.status(200).json({ ok: true, review: rows[0] });
    }

    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });
    const productId = clean(req.query?.id, 50);
    const products = productId
      ? await sql`
          SELECT p.id,p.title,p.description,p.images,p.price,p.stock_quantity,p.stock_managed,p.active,p.created_at,p.updated_at,
            COALESCE(AVG(r.rating) FILTER(WHERE r.status='published'),0)::numeric(3,2) AS rating,
            COUNT(r.id) FILTER(WHERE r.status='published')::int AS reviews_count
          FROM products p LEFT JOIN reviews r ON r.product_id=p.id
          WHERE p.active=true AND p.id=${productId}
          GROUP BY p.id ORDER BY p.title
        `
      : await sql`
          SELECT p.id,p.title,p.description,p.images,p.price,p.stock_quantity,p.stock_managed,p.active,p.created_at,p.updated_at,
            COALESCE(AVG(r.rating) FILTER(WHERE r.status='published'),0)::numeric(3,2) AS rating,
            COUNT(r.id) FILTER(WHERE r.status='published')::int AS reviews_count
          FROM products p LEFT JOIN reviews r ON r.product_id=p.id
          WHERE p.active=true GROUP BY p.id ORDER BY p.title
        `;
    const uploaded = await sql`SELECT id,product_id,sort_order FROM product_images ORDER BY product_id,sort_order,id`;
    const byProduct = new Map();
    for (const image of uploaded) {
      if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, []);
      byProduct.get(image.product_id).push({ id: image.id, url: `/api/product-image?id=${image.id}`, sort_order: image.sort_order });
    }
    const result = products.map(product => {
      const legacy = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
      const stored = byProduct.get(product.id) || [];
      return { ...product, rating: Number(product.rating || 0), reviews_count: Number(product.reviews_count || 0), images: [...legacy, ...stored.map(image => image.url)].slice(0, 8) };
    });
    let reviews = [];
    if (productId) {
      reviews = await sql`
        SELECT r.rating,r.title,r.body,r.published_at,COALESCE(NULLIF(SPLIT_PART(c.name,' ',1),''),'Cliente') AS customer_name
        FROM reviews r LEFT JOIN customers c ON c.id=r.customer_id
        WHERE r.product_id=${productId} AND r.status='published'
        ORDER BY r.published_at DESC LIMIT 20
      `;
    }
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({ products: result, reviews });
  } catch (error) {
    console.error('products api error:', error);
    return res.status(500).json({ error: 'No se pudieron cargar los productos.' });
  }
};
