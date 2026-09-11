const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'catalogo-dinamico.js'), 'utf8');
const cart = fs.readFileSync(path.join(root, 'carrito.js'), 'utf8');

test('home initial HTML does not hardcode product cards or stale prices', () => {
  const gridMatch = home.match(/<div class="grid">([\s\S]*?)<\/div><\/section>/);
  assert.ok(gridMatch, 'catalog grid shell should exist');
  assert.equal(gridMatch[1].trim(), '', 'initial catalog grid should be empty');
  assert.doesNotMatch(home, /<article class="card">/);
  assert.doesNotMatch(home, /\$150\.000 ARS|\$300\.000 ARS/);
});

test('home does not retain legacy catalog product data or handlers', () => {
  assert.doesNotMatch(home, /galleryImages/);
  assert.doesNotMatch(home, /changeGallery\s*\(/);
  assert.doesNotMatch(home, /function\s+pagar\s*\(/);
  assert.doesNotMatch(home, /['"]3377['"]|['"]3375['"]/);
  assert.match(cart, /window\.pagar\s*=/, 'checkout helper should remain owned by carrito.js');
});

test('dynamic catalog remains the sole product renderer', () => {
  assert.match(home, /<script src="\/catalogo-dinamico\.js\?v=6"><\/script>/);
  assert.match(catalog, /fetch\('\/api\/productos'/);
  assert.match(catalog, /grid\.innerHTML = ''/);
  assert.match(catalog, /renderProducts\(grid, products\)/);
});
