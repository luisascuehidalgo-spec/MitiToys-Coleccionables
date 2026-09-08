const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('panel destaca pagos con importe o moneda inválidos', () => {
  const admin = read('admin.html');
  assert.match(admin, /amount_or_currency_mismatch/);
  assert.match(admin, /PAGO CON IMPORTE O MONEDA INVÁLIDOS/);
  assert.match(admin, /REVISAR EN MERCADO PAGO/);
});

test('validation_failed no habilita generación de envío', () => {
  const admin = read('admin.html');
  assert.match(admin, /o\.payment_status==='approved'/);
  assert.doesNotMatch(admin, /o\.payment_status==='validation_failed'.*GENERAR ENVÍO/);
});
