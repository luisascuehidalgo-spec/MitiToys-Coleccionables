const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function rule(source) {
  return (config.headers || []).find(item => item.source === source);
}

function headerMap(source) {
  return Object.fromEntries((rule(source)?.headers || []).map(item => [item.key.toLowerCase(), item.value]));
}

test('todas las rutas reciben headers de seguridad no disruptivos', () => {
  const headers = headerMap('/(.*)');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['content-security-policy'], "frame-ancestors 'none'");
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
});

test('CSP global sólo bloquea framing y no restringe scripts o recursos actuales', () => {
  const csp = headerMap('/(.*)')['content-security-policy'];
  assert.equal(csp, "frame-ancestors 'none'");
  assert.doesNotMatch(csp, /script-src|style-src|img-src|connect-src|default-src/);
});

test('paneles admin no se cachean ni indexan', () => {
  for (const source of ['/admin.html', '/admin-envios.html']) {
    const headers = headerMap(source);
    assert.equal(headers['cache-control'], 'private, no-store, max-age=0');
    assert.equal(headers['x-robots-tag'], 'noindex, nofollow, noarchive');
  }
});

test('todas las APIs admin conocidas son private no-store', () => {
  const adminApis = [
    '/api/admin',
    '/api/admin-auth',
    '/api/admin-product',
    '/api/admin-shipping',
    '/api/admin-image'
  ];
  for (const source of adminApis) {
    assert.equal(headerMap(source)['cache-control'], 'private, no-store, max-age=0', source);
  }
});

test('rewrites y cron de envíos existentes permanecen intactos', () => {
  assert.deepEqual(config.rewrites, [
    { source: '/sitemap.xml', destination: '/api/productos?sitemap=1' },
    { source: '/producto.html', destination: '/api/product-page' },
    { source: '/anuncio', destination: '/api/anuncio' }
  ]);
  assert.ok((config.crons || []).some(cron =>
    cron.path === '/api/envios?action=automation' && cron.schedule === '0 * * * *'
  ));
});
