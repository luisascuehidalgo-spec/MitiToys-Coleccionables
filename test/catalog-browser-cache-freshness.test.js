const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'catalogo-dinamico.js'), 'utf8');

test('catalog browser cache does not outlive the server commercial freshness window', () => {
  assert.match(source, /const CACHE_TTL = 30 \* 1000;/);
  assert.doesNotMatch(source, /const CACHE_TTL = 60 \* 1000;/);
  assert.match(source, /Date\.now\(\) - Number\(value\.savedAt \|\| 0\) > CACHE_TTL/);
});
