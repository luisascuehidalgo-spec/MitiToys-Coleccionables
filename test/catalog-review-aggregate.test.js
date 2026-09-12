const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'productos.js'), 'utf8');

test('catalog listing avoids review aggregation while product detail keeps it', () => {
  const listingStart = source.indexOf(': await sql`\n          SELECT p.id,p.title,p.description,p.images,p.price,p.stock_quantity,p.stock_managed,p.active,p.created_at,p.updated_at');
  assert.notEqual(listingStart, -1);

  const listingEnd = source.indexOf('`;\n    const imageLimit', listingStart);
  assert.notEqual(listingEnd, -1);

  const listingQuery = source.slice(listingStart, listingEnd);
  assert.doesNotMatch(listingQuery, /LEFT JOIN reviews/);
  assert.doesNotMatch(listingQuery, /AVG\(r\.rating\)/);
  assert.doesNotMatch(listingQuery, /COUNT\(r\.id\)/);

  const detailQuery = source.slice(source.indexOf('? await sql`'), listingStart);
  assert.match(detailQuery, /LEFT JOIN reviews/);
  assert.match(detailQuery, /AVG\(r\.rating\)/);
  assert.match(detailQuery, /COUNT\(r\.id\)/);

  assert.match(source, /\.\.\.\(productId \? \{[\s\S]*rating: Number\(product\.rating \|\| 0\),[\s\S]*reviews_count: Number\(product\.reviews_count \|\| 0\)[\s\S]*\} : \{\}\)/);
});
