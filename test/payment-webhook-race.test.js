const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhook = fs.readFileSync(path.join(__dirname, '..', 'api', 'webhook-mercadopago.js'), 'utf8');

function blockBetween(startText, endText) {
  const start = webhook.indexOf(startText);
  const end = webhook.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `No se encontró bloque ${startText}`);
  return webhook.slice(start, end);
}

test('flujo financiero normal compara snapshot antes de liberar stock o notificar', () => {
  const start = webhook.indexOf('const paymentUpdateRows = await sql`');
  const resolve = webhook.indexOf('await resolvePaymentCas(sql, order', start);
  const duplicate = webhook.indexOf('const duplicateSnapshot = paymentUpdateRows.length === 0', resolve);
  const release = webhook.indexOf('stockRelease = await releaseReservedStockIfUnshipped', duplicate);
  const event = webhook.indexOf('const paymentEventRows = await sql`', release);
  const notify = webhook.indexOf('if (notificationType) await queueAndSendOrderNotification', event);

  assert.ok(start >= 0 && resolve > start && duplicate > resolve && release > duplicate && event > release && notify > event);
  const update = webhook.slice(start, resolve);
  assert.match(update, /status IS NOT DISTINCT FROM \$\{order\.status\}/);
  assert.match(update, /payment_id IS NOT DISTINCT FROM \$\{order\.payment_id\}/);
  assert.match(update, /payment_status IS NOT DISTINCT FROM \$\{order\.payment_status\}/);
  assert.match(update, /payment_status_detail IS NOT DISTINCT FROM \$\{order\.payment_status_detail\}/);
});

test('reembolso parcial resuelve CAS antes del evento y nunca libera stock', () => {
  const block = blockBetween('if (partialRefund)', 'const approvedMismatch');
  const update = block.indexOf('const partialRows = await sql`');
  const resolve = block.indexOf('await resolvePaymentCas(sql, order', update);
  const event = block.indexOf('const partialEvents = await sql`', resolve);
  assert.ok(update >= 0 && resolve > update && event > resolve);
  assert.match(block.slice(update, resolve), /status IS NOT DISTINCT FROM \$\{order\.status\}/);
  assert.doesNotMatch(block, /releaseReservedStock/);
  assert.doesNotMatch(block, /queueAndSendOrderNotification/);
});

test('validation_failed y late approval usan CAS antes de registrar eventos', () => {
  const validation = blockBetween('if (approvedMismatch)', 'if (isLateApprovalConflict');
  assert.ok(validation.indexOf('await resolvePaymentCas(sql, order') > validation.indexOf('const validationRows = await sql`'));
  assert.ok(validation.indexOf("'payment.validation_failed'") > validation.indexOf('await resolvePaymentCas(sql, order'));
  assert.match(validation, /status IS NOT DISTINCT FROM \$\{order\.status\}/);

  const late = blockBetween('if (isLateApprovalConflict(oldStatus, payment.status))', 'const newStatus = orderStatusFromPayment');
  assert.ok(late.indexOf('await resolvePaymentCas(sql, order') > late.indexOf('const lateConflictRows = await sql`'));
  assert.ok(late.indexOf("'payment.late_approval_conflict'") > late.indexOf('await resolvePaymentCas(sql, order'));
  assert.match(late, /status IS NOT DISTINCT FROM \$\{order\.status\}/);
  assert.doesNotMatch(late, /releaseReservedStock/);
});

test('múltiples pagos aprobados no marca conflicto desde un snapshot obsoleto', () => {
  const block = blockBetween("if (identityDecision === 'multiple_approved_conflict')", 'let customerId = order.customer_id');
  const update = block.indexOf('const conflictRows = await sql`');
  const resolve = block.indexOf('await resolvePaymentCas(sql, order', update);
  const event = block.indexOf('const conflictEvents = await sql`', resolve);
  assert.ok(update >= 0 && resolve > update && event > resolve);
  assert.match(block, /payment_status_detail IS NOT DISTINCT FROM \$\{order\.payment_status_detail\}/);
});

test('una carrera PAYMENT_ORDER_RACE sale por error antes de cualquier efecto recuperable', () => {
  assert.match(webhook, /const \{ resolvePaymentCas \} = require\('\.\.\/lib\/payment-order-cas'\)/);
  assert.match(webhook, /code=' \+ String\(error\?\.code \|\| error\?\.name \|\| 'WEBHOOK_ERROR'\)/);
  assert.match(webhook, /return res\.status\(500\)\.json\(\{ error: 'Error procesando el Webhook\.' \}\)/);
});
