const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('global security headers enforce HTTPS after the first secure visit', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const globalRule = config.headers.find(rule => rule.source === '/(.*)');
  assert.ok(globalRule, 'global header rule must exist');

  const headers = new Map(globalRule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
});
