const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'templates', 'producto.html'), 'utf8');
test('product availability controls purchase actions', () => {
  assert.equal(source.includes('Sin stock por el momento'), true);
  assert.equal(source.includes('const available=!p.stock_managed'), true);
  assert.equal(source.includes("available?'':'disabled'"), true);
  assert.equal(source.includes("available?'':'hidden'"), true);
});
