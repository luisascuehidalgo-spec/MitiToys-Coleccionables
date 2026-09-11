const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const tracking = fs.readFileSync(require.resolve('../seguimiento.html'), 'utf8');
const faq = fs.readFileSync(require.resolve('../preguntas.html'), 'utf8');
const policies = fs.readFileSync(require.resolve('../politicas.html'), 'utf8');

test('customer-facing tracking instructions require order number and purchase email', () => {
  assert.match(tracking, /número de pedido y el mismo email/i);
  assert.match(faq, /número de pedido[\s\S]*mismo email/i);
  assert.match(policies, /número de pedido y el mismo email/i);
});

test('tracking remains POST-based so purchase email is not put in the URL', () => {
  assert.match(tracking, /fetch\('\/api\/estado-pedido',[\s\S]*method:'POST'/);
  assert.doesNotMatch(tracking, /estado-pedido\?[^'"\s]*email=/i);
});
