const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { paymentIdentityDecision } = require('../lib/payment-reconciliation');

const webhook = fs.readFileSync(path.join(__dirname, '..', 'api', 'webhook-mercadopago.js'), 'utf8');

test('mismo payment_id o primer payment_id se procesa normalmente', () => {
  assert.equal(paymentIdentityDecision({ payment_id: null, payment_status: 'pending' }, { id: 'p1', status: 'pending' }), 'process');
  assert.equal(paymentIdentityDecision({ payment_id: 'p1', payment_status: 'approved' }, { id: 'p1', status: 'refunded' }), 'process');
});

test('un intento secundario no aprobado nunca reemplaza el payment_id canónico', () => {
  for (const status of ['pending', 'in_process', 'rejected', 'cancelled', 'refunded', 'charged_back']) {
    assert.equal(
      paymentIdentityDecision({ payment_id: 'canonical', payment_status: 'pending' }, { id: 'secondary', status }),
      'ignore_secondary'
    );
  }
  assert.match(webhook, /identityDecision === 'ignore_secondary'[\s\S]*payment\.secondary_attempt_ignored[\s\S]*secondary_payment_ignored: true/);
  const start = webhook.indexOf("if (identityDecision === 'ignore_secondary')");
  const end = webhook.indexOf("if (identityDecision === 'multiple_approved_conflict')", start);
  const block = webhook.slice(start, end);
  assert.doesNotMatch(block, /UPDATE orders SET[\s\S]*payment_id=/);
  assert.doesNotMatch(block, /releaseReservedStock/);
});

test('un aprobado nuevo puede reemplazar solo un intento todavía no financiero', () => {
  assert.equal(
    paymentIdentityDecision({ payment_id: 'old-pending', payment_status: 'pending' }, { id: 'new-approved', status: 'approved' }),
    'process'
  );
  assert.equal(
    paymentIdentityDecision({ payment_id: 'old-rejected', payment_status: 'rejected' }, { id: 'new-approved', status: 'approved' }),
    'process'
  );
});

test('un segundo aprobado no reemplaza un pago financiero ya confirmado', () => {
  for (const status of ['approved', 'refunded', 'charged_back', 'validation_failed']) {
    assert.equal(
      paymentIdentityDecision({ payment_id: 'canonical', payment_status: status }, { id: 'secondary', status: 'approved' }),
      'multiple_approved_conflict'
    );
  }

  const start = webhook.indexOf("if (identityDecision === 'multiple_approved_conflict')");
  const end = webhook.indexOf('let customerId = order.customer_id', start);
  assert.ok(start >= 0 && end > start, 'Debe existir el bloque de conflicto antes del flujo normal.');
  const block = webhook.slice(start, end);
  assert.match(block, /payment_status_detail='multiple_approved_conflict'/);
  assert.match(block, /payment\.multiple_approved_conflict/);
  assert.match(block, /current_payment_id: currentPaymentId/);
  assert.match(block, /multiple_approved_conflict: true/);
  assert.doesNotMatch(block, /payment_id=\$\{paymentId\}/);
  assert.doesNotMatch(block, /payment_status='approved'/);
  assert.doesNotMatch(block, /releaseReservedStock/);
});

test('el marcador de múltiples aprobados sobrevive reintentos posteriores del pago canónico', () => {
  assert.match(webhook, /const preservePaymentConflict = order\.payment_status_detail === 'multiple_approved_conflict'/);
  assert.match(webhook, /const providerPaymentStatusDetail = preservePaymentConflict[\s\S]*\? 'multiple_approved_conflict'/);
  assert.match(webhook, /const validationDetail = preservePaymentConflict \? 'multiple_approved_conflict' : 'amount_or_currency_mismatch'/);
  assert.match(webhook, /const lateApprovalDetail = preservePaymentConflict \? 'multiple_approved_conflict' : 'late_approval_conflict'/);
});

test('eventos secundarios se deduplican por payment_id y estado', () => {
  assert.match(webhook, /event_type='payment\.secondary_attempt_ignored'[\s\S]*payload->>'payment_id'=\$\{paymentId\}[\s\S]*COALESCE\(payload->>'status',''\)=\$\{incomingPaymentStatus\}/);
  assert.match(webhook, /event_type='payment\.multiple_approved_conflict'[\s\S]*payload->>'payment_id'=\$\{paymentId\}/);
});
