const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin-product.js'), 'utf8');

test('admin product create records initial stock in the same SQL statement', () => {
  const postBlock = source.slice(source.indexOf("if (req.method === 'POST')"), source.indexOf("if (req.method === 'PUT')"));
  assert.match(postBlock, /WITH inserted AS \([\s\S]*INSERT INTO products/);
  assert.match(postBlock, /inventory_write AS \([\s\S]*INSERT INTO inventory_movements/);
  assert.match(postBlock, /SELECT id,'adjustment',\$\{stock\},'Stock inicial desde panel de administración'[\s\S]*FROM inserted/);
  assert.doesNotMatch(postBlock, /if \(stock !== 0\) await sql/);
});

test('admin product update records stock delta atomically with optimistic update', () => {
  const putBlock = source.slice(source.indexOf("if (req.method === 'PUT')"), source.indexOf("return res.status(405)"));
  assert.match(putBlock, /WITH updated AS \([\s\S]*UPDATE products SET/);
  assert.match(putBlock, /inventory_write AS \([\s\S]*INSERT INTO inventory_movements/);
  assert.match(putBlock, /SELECT id,'adjustment',\$\{delta\},'Ajuste desde panel de administración'[\s\S]*FROM updated/);
  assert.match(putBlock, /date_trunc\('milliseconds',updated_at\)=date_trunc\('milliseconds',\$\{expectedVersion\}::timestamptz\)/);
  assert.doesNotMatch(putBlock, /if \(delta !== 0\) await sql/);
});
