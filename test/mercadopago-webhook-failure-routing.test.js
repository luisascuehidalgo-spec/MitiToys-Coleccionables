const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhook = fs.readFileSync(path.join(__dirname, '..', 'api', 'webhook-mercadopago.js'), 'utf8');

test('webhook distingue falta de configuración de fallos reintentables de Mercado Pago', () => {
  assert.match(
    webhook,
    /error\?\.code === 'MP_NOT_CONFIGURED'[\s\S]{0,220}res\.status\(500\)/
  );
  assert.match(
    webhook,
    /catch \(error\)[\s\S]{0,700}res\.status\(502\)\.json\(\{ error: 'No se pudo consultar el pago\.' \}\)/
  );
});

test('webhook confirma el pago antes de cualquier acceso de negocio a la base', () => {
  const paymentLookup = webhook.indexOf('payment = await getPayment(dataId)');
  const databaseGate = webhook.indexOf('if (process.env.DATABASE_URL && payment.external_reference)');
  assert.ok(paymentLookup >= 0, 'Debe existir el lookup centralizado de pago.');
  assert.ok(databaseGate > paymentLookup, 'La base solo debe consultarse después de confirmar el pago.');
});

test('logging del lookup no usa mensajes ni cuerpos crudos del proveedor', () => {
  const start = webhook.indexOf("'Error consultando pago en Mercado Pago:'");
  const end = webhook.indexOf("return res.status(502).json({ error: 'No se pudo consultar el pago.' });", start);
  assert.ok(start >= 0 && end > start, 'Debe existir el bloque de error sanitizado del lookup.');
  const block = webhook.slice(start, end);
  assert.doesNotMatch(block, /error\?\.message|error\.message|response\.(json|text)|paymentResponse/);
  assert.match(block, /error\?\.code/);
  assert.match(block, /error\?\.providerStatus/);
});
