const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'anuncio.js'), 'utf8');

test('anuncio usa exclusivamente las URLs Cloudinary actuales', () => {
  assert.doesNotMatch(source, /product_images/);
  assert.doesNotMatch(source, /\/api\/product-image/);
  assert.match(source, /SELECT id,title,images FROM products/);
  assert.match(source, /url\.hostname === 'res\.cloudinary\.com'/);
  assert.match(source, /\/mititoys\/products\//);
});

test('anuncio prioriza solo imagenes visibles y difiere la galeria larga', () => {
  assert.match(source, /loading='lazy'/);
  assert.match(source, /fetchpriority='auto'/);
  assert.match(source, /loading:index<3\?'eager':'lazy'/);
  assert.match(source, /fetchpriority:index===0\?'high':'auto'/);
  assert.match(source, /p\.images\.map\(\(url,n\)=>photo\(p,url,n\)\)/);
  assert.doesNotMatch(source, /loading=\\"eager\\"/);
});

test('endpoint legado de imagen sigue cerrado sin acceso a Neon', () => {
  const legacy = fs.readFileSync(path.join(__dirname, '..', 'api', 'product-image.js'), 'utf8');
  assert.match(legacy, /status\(410\)/);
  assert.doesNotMatch(legacy, /getDb|DATABASE_URL|product_images/i);
});
