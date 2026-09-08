const PROTECTED_PAYMENT_STATUSES = new Set([
  'approved',
  'refunded',
  'charged_back',
  'validation_failed'
]);

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
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
  paymentIdentityDecision
};
