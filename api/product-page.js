const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/db');
const { searchParams } = require('../lib/request-url');
const { renderProductSeo } = require('../lib/product-page-seo');

const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'producto.html'), 'utf8');
const clean = (value, max = 80) => String(value || '').trim().slice(0, max);

function serializeProductBootstrap(product) {
  return JSON.stringify(product)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function productImagePreload(images) {
  const first = Array.isArray(images) ? images.find(Boolean) : '';
  if (!first) return '';
  try {
    const url = new URL(String(first));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `<${url.href}>; rel=preload; as=image`;
  } catch (_) {
    return '';
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('Método no permitido');
  const id = clean(searchParams(req).get('id'));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!id) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(template);
  }

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT p.id,p.title,p.description,p.images,p.price,p.stock_quantity,p.stock_managed,
        COALESCE(AVG(r.rating) FILTER(WHERE r.status='published'),0)::numeric(3,2) AS rating,
        COUNT(r.id) FILTER(WHERE r.status='published')::int AS reviews_count
      FROM products p LEFT JOIN reviews r ON r.product_id=p.id
      WHERE p.active=true AND p.id=${id}
      GROUP BY p.id
      LIMIT 1
    `;

    if (!rows.length) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.status(404).send(template);
    }

    const product = {
      ...rows[0],
      images: Array.isArray(rows[0].images) ? rows[0].images.filter(Boolean).slice(0, 8) : [],
      rating: Number(rows[0].rating || 0),
      reviews_count: Number(rows[0].reviews_count || 0)
    };
    const preload = productImagePreload(product.images);
    if (preload) res.setHeader('Link', preload);
    const html = renderProductSeo(template, product)
      .replace('"__MITITOYS_PRODUCT_BOOTSTRAP__"', serializeProductBootstrap(product));
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(html);
  } catch (error) {
    console.error('product-page error:', 'code=' + String(error?.code || error?.name || 'PRODUCT_PAGE_ERROR'));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send(template);
  }
};

module.exports.productImagePreload = productImagePreload;
