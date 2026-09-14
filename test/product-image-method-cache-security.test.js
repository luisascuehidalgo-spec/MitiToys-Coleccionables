const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'product-image.js'), 'utf8');

test('legacy product image method errors are non-cacheable and advertise GET', () => {
  const guardStart = source.indexOf("if (req.method !== 'GET')");
  const guardEnd = source.indexOf('\n  }', guardStart);
  const guard = source.slice(guardStart, guardEnd);

  assert.notEqual(guardStart, -1, 'unsupported method guard must exist');
  assert.match(guard, /Allow', 'GET'/);
  assert.match(guard, /Cache-Control', 'private, no-store, max-age=0'/);
  assert.match(guard, /status\(405\)/);
});

test('legacy GET remains cacheable because the endpoint is permanently gone', () => {
  assert.match(source, /public, max-age=86400, s-maxage=86400, immutable/);
  assert.match(source, /status\(410\)/);
});
