const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const productsApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'productos.js'), 'utf8');

test('order tracking page is private, noindex/nofollow/noarchive and omitted from sitemap', () => {
  const trackingRule = vercel.headers.find(rule => rule.source === '/seguimiento.html');
  const robots = trackingRule?.headers?.find(header => header.key === 'X-Robots-Tag');
  const cache = trackingRule?.headers?.find(header => header.key === 'Cache-Control');
  assert.equal(robots?.value, 'noindex, nofollow, noarchive');
  assert.equal(cache?.value, 'private, no-store, max-age=0');
  const sitemapSection = productsApi.slice(productsApi.indexOf("if (req.method === 'GET' && query.get('sitemap'))"), productsApi.indexOf("if (req.method !== 'GET')"));
  assert.doesNotMatch(sitemapSection, /seguimiento\.html/);
  assert.match(sitemapSection, /preguntas\.html/);
  assert.match(sitemapSection, /politicas\.html/);
});
