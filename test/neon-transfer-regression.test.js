const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('catálogo público no fuerza cache miss ni referencia imágenes binarias de Neon', () => {
  const catalog = read('catalogo-dinamico.js');
  assert.match(catalog, /fetch\('\/api\/productos'/);
  assert.doesNotMatch(catalog, /\/api\/productos\?cb=/);
  assert.doesNotMatch(catalog, /cache:\s*['\"]no-store['\"]/);
  assert.doesNotMatch(catalog, /\/api\/product-image/);
  assert.match(catalog, /mititoys_catalog_cache_v4/);
});

test('home, ficha, carrito y checkout no dependen de imágenes binarias de Neon', () => {
  for (const file of ['index.html', 'producto.html', 'carrito.html', 'checkout.html']) {
    const source = read(file);
    assert.doesNotMatch(source, /\/api\/productos\?cb=/, `${file} volvió a forzar cache-busting del catálogo`);
    assert.doesNotMatch(source, /\/api\/product-image/, `${file} volvió a depender de imágenes binarias de Neon`);
  }
  assert.match(read('producto.html'), /fetch\('\/api\/productos'/);
  assert.match(read('carrito.html'), /fetch\('\/api\/productos'\)/);
  assert.match(read('checkout.html'), /fetch\('\/api\/productos'\)/);
});

test('checkout server no consulta ni publica imágenes binarias de Neon', () => {
  const checkout = read('api/crear-preferencia-carrito.js');
  assert.doesNotMatch(checkout, /product_images/);
  assert.doesNotMatch(checkout, /\/api\/product-image/);
});

test('API pública de productos no consulta product_images y usa caché CDN corta', () => {
  const products = read('api/productos.js');
  assert.doesNotMatch(products, /FROM product_images|JOIN product_images/);
  assert.doesNotMatch(products, /\/api\/product-image/);
  assert.match(products, /s-maxage=60/);
  assert.match(products, /stale-while-revalidate=300/);
  assert.match(products, /private, no-store/);
});

test('endpoint legado de imagen no abre Neon y responde 410', async () => {
  const source = read('api/product-image.js');
  assert.doesNotMatch(source, /getDb|product_images|image_data/);
  assert.match(source, /status\(410\)/);

  const handler = require('../api/product-image');
  const headers = {};
  let statusCode = 200;
  let ended = false;
  const res = {
    status(code) { statusCode = code; return this; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end() { ended = true; return this; }
  };
  await handler({ method: 'GET' }, res);
  assert.equal(statusCode, 410);
  assert.equal(ended, true);
  assert.match(headers['cache-control'], /max-age=86400/);
});

test('javascript del catálogo mantiene sintaxis válida', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'catalogo-dinamico.js')]);
});
