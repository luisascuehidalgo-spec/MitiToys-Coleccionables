const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'cleanup-shipping-quotes.js'), 'utf8');

test('maintenance cleanup prunes only clearly stale unlocked rate-limit counters', () => {
  assert.match(source, /DELETE FROM admin_login_attempts/);
  assert.match(source, /updated_at < NOW\(\) - INTERVAL '24 hours'/);
  assert.match(source, /locked_until IS NULL OR locked_until < NOW\(\)/);
  assert.match(source, /deleted_rate_limits/);
});

test('maintenance cleanup remains cron-authenticated and non-cacheable', () => {
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /Bearer/);
  assert.match(source, /private, no-store, max-age=0/);
  assert.doesNotMatch(source, /DELETE FROM orders|DELETE FROM customers|DELETE FROM products/);
});

test('maintenance cleanup advertises GET on unsupported methods before database access', () => {
  const methodGuardIndex = source.indexOf("if (req.method !== 'GET')");
  const allowIndex = source.indexOf("res.setHeader('Allow', 'GET')");
  const dbIndex = source.indexOf('const sql = getDb()');

  assert.ok(methodGuardIndex >= 0, 'expected a GET-only method guard');
  assert.ok(allowIndex > methodGuardIndex, 'expected Allow: GET inside the method guard');
  assert.ok(dbIndex > allowIndex, 'database access must remain after method rejection');
  assert.match(source, /status\(405\)/);
});
