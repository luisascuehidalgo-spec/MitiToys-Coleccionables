const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const productsApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'productos.js'), 'utf8');

test('order tracking page is noindex and omitted from sitemap', () => {
  const trackingRule = vercel.headers.find(rule => rule.source === '/seguimiento.html');
  const robots = trackingRule?.headers?.find(header => header.key === 'X-Robots-Tag');
  assert.equal(robots?.value, 'noindex, nofollow, noarchive');

  const staticUrlsStart = productsApi.indexOf('const staticUrls = [');
  const productQueryStart = productsApi.indexOf('const productId =');
  assert.notEqual(staticUrlsStart, -1, 'sitemap static URL list must exist');
  assert.notEqual(productQueryStart, -1, 'catalog query must remain after sitemap handling');
  assert.ok(staticUrlsStart < productQueryStart, 'sitemap must be built before normal catalog handling');

  const sitemapSection = productsApi.slice(staticUrlsStart, productQueryStart);
  assert.doesNotMatch(sitemapSection, /seguimiento\.html/);
  assert.match(sitemapSection, /preguntas\.html/);
  assert.match(sitemapSection, /politicas\.html/);
});
