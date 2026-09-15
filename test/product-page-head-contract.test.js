const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'product-page.js'), 'utf8');

test('product page advertises and accepts GET and HEAD', () => {
  assert.match(source, /req\.method !== 'GET' && !isHead/);
  assert.match(source, /setHeader\('Allow', 'GET, HEAD'\)/);
});

test('HEAD responses end without sending an HTML body', () => {
  assert.match(source, /isHead \? res\.status\(200\)\.end\(\)/);
  assert.match(source, /isHead \? res\.status\(404\)\.end\(\)/);
  assert.match(source, /if \(isHead\) return res\.status\(200\)\.end\(\)/);
  assert.match(source, /isHead \? res\.status\(500\)\.end\(\)/);
});
