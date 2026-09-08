const PROTECTED_PAYMENT_STATUSES = new Set([
  'approved',
  'refunded',
  'charged_back',
  'validation_failed'
]);

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isPartialRefund(payment) {
  if (normalize(payment?.status) !== 'approved') return false;
  if (normalize(payment?.status_detail) === 'partially_refunded') return true;
  const transactionAmount = Number(payment?.transaction_amount);
  const refundedAmount = Number(payment?.transaction_amount_refunded);
  return Number.isFinite(transactionAmount)
    && transactionAmount > 0
    && Number.isFinite(refundedAmount)
    && refundedAmount > 0
    && refundedAmount < transactionAmount;
}

function paymentIdentityDecision(order, payment) {
  const currentPaymentId = String(order?.payment_id || '').trim();
  const incomingPaymentId = String(payment?.id || '').trim();
  const incomingStatus = normalize(payment?.status);
  const currentPaymentStatus = normalize(order?.payment_status);

  if (!currentPaymentId || !incomingPaymentId || currentPaymentId === incomingPaymentId) {
    return 'process';
  }

  if (incomingStatus !== 'approved') {
    return 'ignore_secondary';
  }

  if (PROTECTED_PAYMENT_STATUSES.has(currentPaymentStatus)) {
    return 'multiple_approved_conflict';
  }

  return 'process';
}

module.exports = {
  PROTECTED_PAYMENT_STATUSES,
  isPartialRefund,
  paymentIdentityDecision
};
