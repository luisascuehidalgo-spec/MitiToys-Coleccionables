const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../api/admin-image.js'), 'utf8');

test('admin image uploads use products.images only', () => {
  assert.doesNotMatch(source, /product_images/i);
  assert.match(source, /jsonb_array_length\(images\)/);
  assert.match(source, /SET images=COALESCE\(images,'\[\]'::jsonb\)/);
});

test('legacy binary delete is retired without touching the database', () => {
  const deleteBlock = source.slice(source.indexOf("if (req.method === 'DELETE')"), source.indexOf("if (req.method === 'POST')"));
  assert.match(deleteBlock, /status\(410\)/);
  assert.doesNotMatch(deleteBlock, /getDb|DELETE FROM|sql`/);
});
