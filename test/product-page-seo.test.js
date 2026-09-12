const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderProductSeo } = require('../lib/product-page-seo');

const root = path.join(__dirname, '..');
const templatePath = path.join(root, 'templates', 'producto.html');
const template = fs.readFileSync(templatePath, 'utf8');

test('server product renderer writes product-specific metadata into raw HTML', () => {
  const product = {
    id: '3142',
    title: 'Figura Luffy Gear 5 Nika',
    description: 'Figura coleccionable de One Piece con detalles de Gear 5.',
    images: ['https://example.com/luffy.jpg'],
    price: '150000.00',
    stock_managed: true,
    stock_quantity: 5,
    rating: 4.75,
    reviews_count: 8
  };
  const html = renderProductSeo(template, product);
  assert.match(html, /<title>Figura Luffy Gear 5 Nika \| Mititoys<\/title>/);
  assert.match(html, /canonical" href="https:\/\/mititoys\.com\/producto\.html\?id=3142"/);
  assert.match(html, /property="og:title" content="Figura Luffy Gear 5 Nika"/);
  assert.match(html, /property="og:image" content="https:\/\/example\.com\/luffy\.jpg"/);
  assert.match(html, /"priceCurrency":"ARS"/);
  assert.match(html, /"availability":"https:\/\/schema\.org\/InStock"/);
  assert.match(html, /"reviewCount":8/);
});

test('out-of-stock product schema is rendered as OutOfStock', () => {
  const html = renderProductSeo(template, { id: 'x', title: 'Sin stock', images: [], price: 10, stock_managed: true, stock_quantity: 0 });
  assert.match(html, /"availability":"https:\/\/schema\.org\/OutOfStock"/);
});

test('vercel product URL cannot be shadowed by a public static producto.html', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some(rule => rule.source === '/producto.html' && rule.destination === '/api/product-page'));
  assert.equal(fs.existsSync(path.join(root, 'producto.html')), false);
  assert.equal(fs.existsSync(templatePath), true);
  const source = fs.readFileSync(path.join(root, 'api/product-page.js'), 'utf8');
  assert.match(source, /templates.*producto\.html/);
  assert.match(source, /searchParams\(req\)/);
  assert.doesNotMatch(source, /req\.query/);
  assert.match(source, /renderProductSeo\(template, product\)/);
});

test('product page bootstraps the current server product and has no hardcoded product fallbacks', () => {
  const source = fs.readFileSync(path.join(root, 'api/product-page.js'), 'utf8');
  assert.match(template, /const serverProduct="__MITITOYS_PRODUCT_BOOTSTRAP__";/);
  assert.doesNotMatch(template, /const fallbacks\s*=/);
  assert.doesNotMatch(template, /20241123034449_1\.jpg/);
  assert.doesNotMatch(template, /COD-3375\/main/);
  assert.match(template, /typeof serverProduct==='object'/);
  assert.match(source, /function serializeProductBootstrap\(product\)/);
  assert.match(source, /replace\('\"__MITITOYS_PRODUCT_BOOTSTRAP__\"', serializeProductBootstrap\(product\)\)/);
  assert.match(source, /replace\(\/&\/g, '\\\\u0026'\)/);
  assert.match(source, /replace\(\/<\/g, '\\\\u003c'\)/);
});
