const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'productos.js'), 'utf8');

test('productos rejects unsupported methods before opening database access', () => {
  const methodGuard = source.indexOf("if (method !== 'GET' && method !== 'POST')");
  const dbAccess = source.indexOf('const sql = getDb();');

  assert.notEqual(methodGuard, -1, 'unsupported method guard must exist');
  assert.notEqual(dbAccess, -1, 'database access must exist for supported methods');
  assert.ok(methodGuard < dbAccess, 'unsupported methods must be rejected before getDb()');
});

test('productos unsupported method response is explicitly non-cacheable and advertises allowed methods', () => {
  const guardStart = source.indexOf("if (method !== 'GET' && method !== 'POST')");
  const guardEnd = source.indexOf('\n  }', guardStart);
  const guard = source.slice(guardStart, guardEnd);

  assert.match(guard, /Cache-Control', 'private, no-store, max-age=0'/);
  assert.match(guard, /Allow', 'GET, POST'/);
  assert.match(guard, /status\(405\)/);
});
