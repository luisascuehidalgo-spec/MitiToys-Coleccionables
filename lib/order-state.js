const PAID_STATES = new Set(['approved', 'processing', 'shipped', 'delivered']);
const CANCELLED_PAYMENT_STATES = new Set(['cancelled', 'rejected']);
const REFUNDED_PAYMENT_STATES = new Set(['refunded', 'charged_back']);

const normalize = value => String(value || '').trim().toLowerCase();

function validateAdminStatusTransition(order, targetStatus) {
  const target = normalize(targetStatus);
  const payment = normalize(order?.payment_status);
  const paymentId = String(order?.payment_id || '').trim();

  if (PAID_STATES.has(target) && payment !== 'approved') {
    return 'Mercado Pago todavía no confirmó el pago. No se puede avanzar el pedido a un estado de compra pagada.';
  }

  if (target === 'refunded' && !REFUNDED_PAYMENT_STATES.has(payment)) {
    return 'El pedido solo puede marcarse como reembolsado cuando Mercado Pago confirme el reembolso.';
  }

  if (target === 'cancelled' && paymentId && !CANCELLED_PAYMENT_STATES.has(payment)) {
    return 'Este pedido ya tiene un pago en Mercado Pago. Cancelalo o reembolsalo primero desde Mercado Pago.';
  }

  if (target === 'pending' && (payment === 'approved' || CANCELLED_PAYMENT_STATES.has(payment) || REFUNDED_PAYMENT_STATES.has(payment))) {
    return 'No se puede volver este pedido a pendiente porque Mercado Pago ya informó un estado definitivo del pago.';
  }

  return null;
}

function publicOrderStatus(order) {
  const stored = normalize(order?.status) || 'pending';
  const payment = normalize(order?.payment_status);

  if (REFUNDED_PAYMENT_STATES.has(payment)) return 'refunded';
  if (CANCELLED_PAYMENT_STATES.has(payment)) return 'cancelled';

  if (payment !== 'approved') {
    return stored === 'cancelled' ? 'cancelled' : 'pending';
  }

  return PAID_STATES.has(stored) ? stored : 'approved';
}

module.exports = {
  PAID_STATES,
  CANCELLED_PAYMENT_STATES,
  REFUNDED_PAYMENT_STATES,
  validateAdminStatusTransition,
  publicOrderStatus
};
