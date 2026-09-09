const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api/estado-pedido.js'), 'utf8');
const orderPage = fs.readFileSync(path.join(root, 'pedido.html'), 'utf8');
const trackingPage = fs.readFileSync(path.join(root, 'seguimiento.html'), 'utf8');

test('consulta pública de pedido usa POST JSON y nunca coloca el email en la URL', () => {
  assert.match(api, /req\.method\s*!==\s*['"]POST['"]/);
  assert.match(api, /contentType\s*!==\s*['"]application\/json['"]/);
  assert.match(api, /status\(415\)/);
  assert.match(api, /req\.body\s*\|\|\s*\{\}/);
  assert.match(api, /body\.pedido/);
  assert.match(api, /body\.email/);
  assert.doesNotMatch(api, /searchParams\s*\(/);
  assert.doesNotMatch(api, /query\.get\s*\(\s*['"]email['"]\s*\)/);

  for (const [name, source] of [['pedido.html', orderPage], ['seguimiento.html', trackingPage]]) {
    assert.match(source, /fetch\(['"]\/api\/estado-pedido['"]\s*,\s*\{/m, name);
    assert.match(source, /method\s*:\s*['"]POST['"]/m, name);
    assert.match(source, /['"]Content-Type['"]\s*:\s*['"]application\/json['"]/m, name);
    assert.match(source, /JSON\.stringify\s*\(\s*\{\s*pedido\s*:/m, name);
    assert.doesNotMatch(source, /\/api\/estado-pedido\?[^'"`]*email=/i, name);
  }
});

test('todas las respuestas de seguimiento son privadas y no cacheables', () => {
  const cacheIndex = api.indexOf("res.setHeader('Cache-Control', 'private, no-store, max-age=0')");
  const methodIndex = api.indexOf("if (req.method !== 'POST')");
  assert.ok(cacheIndex >= 0, 'falta Cache-Control privado/no-store');
  assert.ok(methodIndex >= 0, 'falta guard de método');
  assert.ok(cacheIndex < methodIndex, 'Cache-Control debe aplicarse incluso a errores 4xx/5xx');
});

test('respuesta pública no expone identificadores internos de Mercado Pago ni id interno del pedido', () => {
  assert.doesNotMatch(api, /\bo\.preference_id\b/);
  assert.doesNotMatch(api, /\bpreference_id\b/);
  assert.match(api, /delete\s+order\.id/);
});

test('email del comprador no persiste en almacenamiento local del navegador', () => {
  for (const [name, source] of [['pedido.html', orderPage], ['seguimiento.html', trackingPage]]) {
    assert.doesNotMatch(source, /mititoys_last_order_email/i, name);
    assert.doesNotMatch(source, /localStorage/i, name);
  }
});

test('URL pendiente de pago conserva allowlist HTTPS de Mercado Pago', () => {
  assert.match(api, /url\.protocol\s*!==\s*['"]https:['"]/);
  assert.match(api, /mercadopago\.com/);
  assert.match(api, /mercadopago\.com\.ar/);
  assert.match(api, /safePendingPaymentUrl\(order\)/);
});
