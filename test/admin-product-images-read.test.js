const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adminApi = fs.readFileSync(path.join(root, 'api', 'admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

test('admin API no longer reads legacy product_images while UI tolerates missing uploaded_images', () => {
  assert.doesNotMatch(adminApi, /FROM\s+product_images/i);
  assert.doesNotMatch(adminApi, /productImages\s*=/);
  assert.doesNotMatch(adminApi, /product\.uploaded_images\s*=/);
  assert.match(adminHtml, /Array\.isArray\(p\.uploaded_images\)\?p\.uploaded_images:\[\]/);
  assert.match(adminHtml, /existing\?\.uploaded_images\|\|\[\]/);
});
