const PAID_OPERATIONAL_STATUSES = new Set(['approved', 'processing', 'shipped', 'delivered']);
const REFUNDED_PAYMENT_STATUSES = new Set(['refunded', 'charged_back']);
const CANCELLED_PAYMENT_STATUSES = new Set(['cancelled', 'rejected']);

function orderStatusFromPayment(currentStatus, paymentStatus) {
  const current = String(currentStatus || 'pending');
  const payment = String(paymentStatus || 'pending');

  if (REFUNDED_PAYMENT_STATUSES.has(payment)) return 'refunded';
  if (CANCELLED_PAYMENT_STATUSES.has(payment)) return current === 'refunded' ? 'refunded' : 'cancelled';

  if (payment === 'approved') {
    if (['processing', 'shipped', 'delivered'].includes(current)) return current;
    if (['cancelled', 'refunded'].includes(current)) return current;
    return 'approved';
  }

  if (PAID_OPERATIONAL_STATUSES.has(current) || ['cancelled', 'refunded'].includes(current)) return current;
  return 'pending';
}

function adminStatusError({ currentStatus, targetStatus, paymentId, paymentStatus }) {
  const current = String(currentStatus || 'pending');
  const target = String(targetStatus || '');
  const payment = String(paymentStatus || 'pending');

  if (current === target) return null;

  if (PAID_OPERATIONAL_STATUSES.has(target) && payment !== 'approved') {
    return 'No se puede avanzar el pedido hasta que Mercado Pago confirme el pago como aprobado.';
  }

  if (target === 'refunded' && !REFUNDED_PAYMENT_STATUSES.has(payment)) {
    return 'El pedido solo puede marcarse como reembolsado cuando Mercado Pago confirme el reembolso.';
  }

  if (target === 'cancelled' && paymentId && !CANCELLED_PAYMENT_STATUSES.has(payment)) {
    return 'Este pedido ya tiene un pago en Mercado Pago. Cancelalo o reembolsalo primero desde Mercado Pago.';
  }

  if (target === 'pending' && payment === 'approved') {
    return 'Un pago aprobado no puede volver manualmente a pendiente.';
  }

  return null;
}

function adminStatusOptions(order) {
  const current = String(order?.status || 'pending');
  const payment = String(order?.payment_status || 'pending');
  const paymentId = order?.payment_id;
  const options = new Set([current]);

  if (payment === 'approved') {
    ['approved', 'processing', 'shipped', 'delivered'].forEach(status => options.add(status));
  } else if (REFUNDED_PAYMENT_STATUSES.has(payment)) {
    options.add('refunded');
  } else if (CANCELLED_PAYMENT_STATUSES.has(payment)) {
    options.add('cancelled');
  } else {
    options.add('pending');
    if (!paymentId) options.add('cancelled');
  }

  return [...options];
}

module.exports = {
  PAID_OPERATIONAL_STATUSES,
  REFUNDED_PAYMENT_STATUSES,
  CANCELLED_PAYMENT_STATUSES,
  orderStatusFromPayment,
  adminStatusError,
  adminStatusOptions
};
