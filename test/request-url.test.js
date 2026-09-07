const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { searchParams } = require('../lib/request-url');

// Regression guard for Vercel Node runtimes: API code must parse req.url directly.
test('parsea query params con WHATWG URL sin depender de req.query', () => {
  const query = searchParams({ url: '/api/productos?id=3377&review_token=a%20b&data.id=123' });
  assert.equal(query.get('id'), '3377');
  assert.equal(query.get('review_token'), 'a b');
  assert.equal(query.get('data.id'), '123');
});

test('acepta URL absoluta y request sin url', () => {
  assert.equal(searchParams({ url: 'https://mititoys.com/api/envios?action=localities' }).get('action'), 'localities');
  assert.equal(searchParams({}).toString(), '');
});

test('ninguna API usa el getter legacy req.query de Vercel', () => {
  const apiDir = path.join(__dirname, '..', 'api');
  const offenders = [];
  for (const file of fs.readdirSync(apiDir).filter(name => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(apiDir, file), 'utf8');
    if (/\breq\.query\b/.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test('lib/db no conserva el listener diagnóstico DEP0169', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf8');
  assert.doesNotMatch(source, /DEP0169|process\.on\(['"]warning['"]/);
});
