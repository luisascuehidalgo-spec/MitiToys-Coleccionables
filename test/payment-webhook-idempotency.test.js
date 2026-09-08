const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhook = fs.readFileSync(path.join(__dirname, '..', 'api', 'webhook-mercadopago.js'), 'utf8');

test('webhook no reprocesa un estado de pago idéntico', () => {
  assert.match(webhook, /const paymentUpdateRows = await sql`[\s\S]*payment_id IS DISTINCT FROM \$\{paymentId\}[\s\S]*payment_status IS DISTINCT FROM \$\{providerPaymentStatus\}[\s\S]*payment_status_detail IS DISTINCT FROM \$\{providerPaymentStatusDetail\}[\s\S]*status IS DISTINCT FROM \$\{newStatus\}[\s\S]*RETURNING id/);
  assert.match(webhook, /if \(!paymentUpdateRows\.length\) \{[\s\S]*duplicate: true[\s\S]*\}/);

  const duplicateGuard = webhook.indexOf('if (!paymentUpdateRows.length)');
  const stockRelease = webhook.indexOf('stockRelease = await releaseReservedStockIfUnshipped', duplicateGuard);
  const eventInsert = webhook.indexOf('INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)', duplicateGuard);
  assert.ok(duplicateGuard >= 0 && stockRelease > duplicateGuard, 'El release debe ocurrir después del guard de duplicados.');
  assert.ok(eventInsert > duplicateGuard, 'El evento debe insertarse después del guard de duplicados.');
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
