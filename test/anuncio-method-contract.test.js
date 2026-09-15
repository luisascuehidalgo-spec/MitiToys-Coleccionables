const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'anuncio.js'), 'utf8');

test('anuncio advertises GET and HEAD for unsupported methods', () => {
  assert.match(source, /req\.method !== 'GET' && req\.method !== 'HEAD'/);
  assert.match(source, /setHeader\('Allow', 'GET, HEAD'\)/);
  assert.match(source, /status\(405\)\.send\('Método no permitido\.'\)/);
});

test('anuncio rejects unsupported methods before opening the database', () => {
  const methodGuard = source.indexOf("req.method !== 'GET'");
  const allowHeader = source.indexOf("setHeader('Allow', 'GET, HEAD')");
  const databaseOpen = source.indexOf('const sql = getDb()');
  assert.ok(methodGuard >= 0 && allowHeader > methodGuard && databaseOpen > allowHeader);
});
