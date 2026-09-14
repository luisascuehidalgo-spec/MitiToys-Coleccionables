const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../api/admin-image.js'), 'utf8');

test('admin image responses are private and non-cacheable before auth', () => {
  const cacheIndex = source.indexOf("res.setHeader('Cache-Control', 'private, no-store, max-age=0')");
  const authIndex = source.indexOf('if (!verify(req))');

  assert.notEqual(cacheIndex, -1, 'admin-image must set an explicit private no-store policy');
  assert.notEqual(authIndex, -1, 'admin-image must preserve authentication');
  assert.ok(cacheIndex < authIndex, 'cache policy must cover 401 responses as well as authenticated responses');
});

test('admin image parses request URL only for authenticated POST uploads', () => {
  const authIndex = source.indexOf('if (!verify(req))');
  const postIndex = source.indexOf("if (req.method === 'POST')");
  const queryIndex = source.indexOf('const query = searchParams(req)');

  assert.ok(authIndex < postIndex, 'authentication must happen before upload handling');
  assert.ok(postIndex < queryIndex, 'request URL parsing must be scoped to POST uploads');
});

test('admin image method errors advertise supported methods', () => {
  assert.match(source, /res\.setHeader\('Allow',\s*'GET, POST, DELETE'\)/);
  assert.match(source, /status\(405\)/);
});
