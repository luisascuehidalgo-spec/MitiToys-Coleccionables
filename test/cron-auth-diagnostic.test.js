const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../api/cron-auth-diagnostic.js'), 'utf8');

test('cron auth diagnostic never logs or returns secret/header values', () => {
  assert.match(source, /cron_secret_missing/);
  assert.match(source, /authorization_mismatch/);
  assert.match(source, /reason=' \+ reason/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*(?:secret|authorization)/i);
  assert.doesNotMatch(source, /json\([^\n]*(?:secret|authorization)/i);
});

test('diagnostic remains read-only and no-store', () => {
  assert.match(source, /req\.method !== 'GET'/);
  assert.match(source, /private, no-store, max-age=0/);
  assert.doesNotMatch(source, /getDb|UPDATE|INSERT|DELETE|fetch\(/);
});
