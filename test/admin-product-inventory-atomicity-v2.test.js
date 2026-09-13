const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { neon } = require('@neondatabase/serverless');
const { supportsAtomicInventoryWrite } = require('../api/admin-product');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin-product.js'), 'utf8');

test('the installed Neon HTTP adapter selects the atomic inventory path', () => {
  const sql = neon('postgresql://user:pass@localhost/test');
  assert.equal(typeof sql.query, 'function');
  assert.equal(supportsAtomicInventoryWrite(sql), true);
  assert.equal(supportsAtomicInventoryWrite(async () => {}), false);
});

test('product creation couples initial stock ledger write to the inserted product CTE', () => {
  assert.match(source, /WITH inserted AS \([\s\S]*INSERT INTO products/);
  assert.match(source, /inventory_write AS \([\s\S]*INSERT INTO inventory_movements[\s\S]*FROM inserted/);
  assert.match(source, /WHERE \$\{stock\} <> 0/);
});

test('product update couples stock delta ledger write to the successful optimistic update CTE', () => {
  assert.match(source, /WITH updated AS \([\s\S]*UPDATE products SET/);
  assert.match(source, /date_trunc\('milliseconds',updated_at\)=date_trunc\('milliseconds',\$\{expectedVersion\}::timestamptz\)/);
  assert.match(source, /inventory_write AS \([\s\S]*INSERT INTO inventory_movements[\s\S]*FROM updated/);
  assert.match(source, /WHERE \$\{delta\} <> 0/);
});
