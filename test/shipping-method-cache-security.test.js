const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../api/envios-gateway.js'), 'utf8');

test('shipping gateway applies private no-store before routing any method', () => {
  const cache = source.indexOf("res.setHeader('Cache-Control', 'private, no-store, max-age=0')");
  const methodGuard = source.indexOf("if (req.method !== 'POST')");
  assert.ok(cache >= 0 && methodGuard >= 0 && cache < methodGuard);
});

test('unsupported shipping methods are rejected before backend, DB and provider work', () => {
  const methodGuard = source.indexOf("if (req.method !== 'POST')");
  const backend = source.indexOf('return shippingHandler(req, res);', methodGuard);
  const rateLimitDb = source.indexOf('consumeShippingQuoteAttempt(getDb(), ipHash)');

  assert.ok(methodGuard >= 0 && backend >= 0 && rateLimitDb >= 0);
  assert.match(source, /if \(req\.method === 'GET'\) return shippingHandler\(req, res\);/);
  assert.match(source, /res\.setHeader\('Allow', 'GET, POST'\);/);
  assert.match(source, /return res\.status\(405\)\.json\(\{ error: 'Método no permitido\.' \}\);/);
  assert.ok(source.indexOf("return res.status(405)", methodGuard) < rateLimitDb,
    '405 must happen before rate-limit DB access');
});
