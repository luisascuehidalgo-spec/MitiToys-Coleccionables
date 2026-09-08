const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhook = fs.readFileSync(path.join(__dirname, '..', 'api', 'webhook-mercadopago.js'), 'utf8');

test('snapshot idéntico no reescribe el pedido pero reanuda efectos idempotentes pendientes', () => {
  assert.match(webhook, /const paymentUpdateRows = await sql`[\s\S]*payment_id IS DISTINCT FROM \$\{paymentId\}[\s\S]*payment_status IS DISTINCT FROM \$\{providerPaymentStatus\}[\s\S]*payment_status_detail IS DISTINCT FROM \$\{providerPaymentStatusDetail\}[\s\S]*status IS DISTINCT FROM \$\{newStatus\}[\s\S]*RETURNING id/);
  assert.match(webhook, /const duplicateSnapshot = paymentUpdateRows\.length === 0/);

  const duplicateFlag = webhook.indexOf('const duplicateSnapshot = paymentUpdateRows.length === 0');
  const stockRelease = webhook.indexOf('stockRelease = await releaseReservedStockIfUnshipped', duplicateFlag);
  const eventInsert = webhook.indexOf('const paymentEventRows = await sql`', duplicateFlag);
  const notification = webhook.indexOf('if (notificationType) await queueAndSendOrderNotification', duplicateFlag);
  const response = webhook.indexOf('event_recovered: duplicateSnapshot && paymentEventRows.length > 0', duplicateFlag);
  assert.ok(duplicateFlag >= 0, 'Falta identificar el snapshot duplicado sin salir temprano.');
  assert.ok(stockRelease > duplicateFlag, 'El retry terminal debe poder completar la liberación después de detectar duplicado.');
  assert.ok(eventInsert > stockRelease, 'El evento recuperable debe ejecutarse después del release idempotente.');
  assert.ok(notification > eventInsert, 'La notificación idempotente debe poder reintentarse después del evento.');
  assert.ok(response > notification, 'La respuesta 200 debe ocurrir después de intentar completar los efectos.');

  const resumableBlock = webhook.slice(duplicateFlag, response);
  assert.doesNotMatch(resumableBlock, /if \(!paymentUpdateRows\.length\)[\s\S]*return res\.status\(200\)/);
});

test('evento de estado de pago se deduplica por identidad y snapshot del proveedor', () => {
  assert.match(webhook, /const paymentEventType = \['payment\.created', 'payment\.updated'\]\.includes\(body\.action\)/);
  assert.match(webhook, /event_type IN \('payment\.created','payment\.updated','payment\.notification'\)/);
  assert.match(webhook, /payload->>'payment_id'=\$\{paymentId\}/);
  assert.match(webhook, /COALESCE\(payload->>'status',''\)=\$\{eventStatus\}/);
  assert.match(webhook, /COALESCE\(payload->>'status_detail',''\)=\$\{eventStatusDetail\}/);
  assert.match(webhook, /RETURNING id/);
});

test('retry solo recupera notificaciones coherentes con el estado financiero actual', () => {
  assert.match(webhook, /providerPaymentStatus === 'approved' && newStatus === 'approved'[\s\S]*notificationType = 'payment_approved'/);
  assert.match(webhook, /\['cancelled','rejected'\]\.includes\(String\(providerPaymentStatus \|\| ''\)\) && newStatus === 'cancelled'[\s\S]*notificationType = 'order_cancelled'/);
  assert.match(webhook, /\['refunded','charged_back'\]\.includes\(String\(providerPaymentStatus \|\| ''\)\) && newStatus === 'refunded'[\s\S]*notificationType = 'order_refunded'/);
});

test('validation_failed y late approval solo generan evento cuando cambia el marcador persistido', () => {
  assert.match(webhook, /const validationDetail = preservePaymentConflict \? 'multiple_approved_conflict' : 'amount_or_currency_mismatch'/);
  assert.match(webhook, /const validationRows = await sql`[\s\S]*payment_status IS DISTINCT FROM 'validation_failed'[\s\S]*payment_status_detail IS DISTINCT FROM \$\{validationDetail\}[\s\S]*RETURNING id/);
  assert.match(webhook, /if \(validationRows\.length\) \{[\s\S]*'payment\.validation_failed'/);
  assert.match(webhook, /duplicate: validationRows\.length === 0/);

  assert.match(webhook, /const lateApprovalDetail = preservePaymentConflict \? 'multiple_approved_conflict' : 'late_approval_conflict'/);
  assert.match(webhook, /const lateConflictRows = await sql`[\s\S]*payment_status_detail IS DISTINCT FROM \$\{lateApprovalDetail\}[\s\S]*RETURNING id/);
  assert.match(webhook, /if \(lateConflictRows\.length\) \{[\s\S]*'payment\.late_approval_conflict'/);
  assert.match(webhook, /duplicate: lateConflictRows\.length === 0/);
  assert.doesNotMatch(webhook, /const alreadyMarked =/);
});

test('conflictos de ownership no repiten el mismo evento en reintentos secuenciales', () => {
  assert.match(webhook, /'payment\.ownership_conflict'[\s\S]*WHERE NOT EXISTS \([\s\S]*event_type='payment\.ownership_conflict'[\s\S]*payload->>'payment_id'=\$\{paymentId\}[\s\S]*payload->>'conflicting_order_id'=\$\{conflictingOrderId\}/);
});
