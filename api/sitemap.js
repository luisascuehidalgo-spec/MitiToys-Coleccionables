const { getDb } = require('../lib/db');

const escapeXml = value => String(value ?? '').replace(/[<>&'\"]/g, char => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;'
}[char]));

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const sql = getDb();
    const products = await sql`
      SELECT id, updated_at
      FROM products
      WHERE active=true
      ORDER BY updated_at DESC
    `;
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
  } catch (error) {
    console.error('sitemap error:', error);
    return res.status(500).send('');
  }
};
