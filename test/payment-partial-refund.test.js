const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isPartialRefund } = require('../lib/payment-reconciliation');
const { requiresPaymentReview, adminStatusError, adminStatusOptions } = require('../lib/order-state');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const webhook = read('api/webhook-mercadopago.js');
const adminApi = read('api/admin.js');

test('detecta reembolso parcial sin confundirlo con reembolso total', () => {
  assert.equal(isPartialRefund({ status: 'approved', status_detail: 'partially_refunded', transaction_amount: 100, transaction_amount_refunded: 0 }), true);
  assert.equal(isPartialRefund({ status: 'approved', transaction_amount: 100, transaction_amount_refunded: 25 }), true);
  assert.equal(isPartialRefund({ status: 'approved', transaction_amount: 100, transaction_amount_refunded: 100 }), false);
  assert.equal(isPartialRefund({ status: 'refunded', status_detail: 'refunded', transaction_amount: 100, transaction_amount_refunded: 100 }), false);
  assert.equal(isPartialRefund({ status: 'approved', transaction_amount: 100, transaction_amount_refunded: 0 }), false);
});

test('partially_refunded exige revisión y bloquea avance manual', () => {
  const order = {
    status: 'approved',
    payment_id: 'p1',
    payment_status: 'approved',
    payment_status_detail: 'partially_refunded'
  };
  assert.equal(requiresPaymentReview(order), true);
  assert.match(
    adminStatusError({
      currentStatus: 'approved',
      targetStatus: 'processing',
      paymentId: 'p1',
      paymentStatus: 'approved',
      paymentStatusDetail: 'partially_refunded'
    }),
    /revisión manual/i
  );
  assert.deepEqual(adminStatusOptions(order), ['approved']);
});

test('webhook conserva estado y no libera stock ante reembolso parcial', () => {
  assert.match(webhook, /const partialRefund = isPartialRefund\(payment\)/);
  const start = webhook.indexOf('if (partialRefund)');
  const end = webhook.indexOf('const approvedMismatch', start);
  assert.ok(start >= 0 && end > start, 'Debe existir un bloque aislado para reembolso parcial.');
  const block = webhook.slice(start, end);
  assert.match(block, /payment_status='approved'/);
  assert.match(block, /payment_status_detail=\$\{partialRefundDetail\}/);
  assert.match(block, /status=\$\{oldStatus\}/);
  assert.match(block, /payment\.partial_refund_detected/);
  assert.match(block, /partial_refund: true/);
  assert.doesNotMatch(block, /releaseReservedStock/);
  assert.doesNotMatch(block, /queueAndSendOrderNotification/);
});

test('evento de reembolso parcial se deduplica por payment_id e importe reintegrado', () => {
  assert.match(webhook, /event_type='payment\.partial_refund_detected'/);
  assert.match(webhook, /payload->>'payment_id'=\$\{paymentId\}/);
  assert.match(webhook, /payload->>'refunded_amount','0'\)=\$\{refundedAmountKey\}/);
});

test('backend de Enviopack bloquea pagos que requieren revisión en todas las barreras', () => {
  assert.match(adminApi, /requiresPaymentReview\(order\)[\s\S]*PAYMENT_REQUIRES_REVIEW/);
  assert.match(adminApi, /payment_status='approved'[\s\S]*payment_status_detail[\s\S]*multiple_approved_conflict[\s\S]*partially_refunded/);
  assert.match(adminApi, /requiresPaymentReview\(firstPaymentGuard\[0\]\)/);
  assert.match(adminApi, /requiresPaymentReview\(secondPaymentGuard\[0\]\)/);
  assert.match(adminApi, /requiresPaymentReview\(finalPaymentGuard\[0\]\)/);
});
