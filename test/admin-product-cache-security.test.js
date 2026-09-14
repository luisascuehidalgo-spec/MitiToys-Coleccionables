const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../api/admin-product.js'), 'utf8');

test('admin product responses are private and non-cacheable before auth', () => {
  const cacheIndex = source.indexOf("res.setHeader('Cache-Control', 'private, no-store, max-age=0')");
  const authIndex = source.indexOf('if (!verify(req))');

  assert.notEqual(cacheIndex, -1, 'admin-product must set an explicit private no-store policy');
  assert.notEqual(authIndex, -1, 'admin-product must preserve authentication');
  assert.ok(cacheIndex < authIndex, 'cache policy must cover 401 responses as well as authenticated responses');
});

test('admin product method errors advertise POST and PUT', () => {
  assert.match(source, /res\.setHeader\('Allow',\s*'POST, PUT'\)/);
  assert.match(source, /status\(405\)/);
});
