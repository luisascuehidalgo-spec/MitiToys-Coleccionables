const PAID_OPERATIONAL_STATUSES = new Set(['approved', 'processing', 'shipped', 'delivered']);
const FULFILLMENT_STATUSES = new Set(['processing', 'shipped', 'delivered']);
const REFUNDED_PAYMENT_STATUSES = new Set(['refunded', 'charged_back']);
const CANCELLED_PAYMENT_STATUSES = new Set(['cancelled', 'rejected']);
const FULFILLMENT_RANK = { approved: 1, processing: 2, shipped: 3, delivered: 4 };

function normalize(value, fallback = '') {
  return String(value ?? fallback).trim().toLowerCase();
}

function orderStatusFromPayment(currentStatus, paymentStatus) {
  const current = normalize(currentStatus, 'pending');
  const payment = normalize(paymentStatus, 'pending');

  if (REFUNDED_PAYMENT_STATUSES.has(payment)) return 'refunded';
  if (CANCELLED_PAYMENT_STATUSES.has(payment)) return current === 'refunded' ? 'refunded' : 'cancelled';

  if (payment === 'approved') {
    if (FULFILLMENT_STATUSES.has(current)) return current;
    if (['cancelled', 'refunded'].includes(current)) return current;
    return 'approved';
  }

  if (PAID_OPERATIONAL_STATUSES.has(current) || ['cancelled', 'refunded'].includes(current)) return current;
  return 'pending';
}

function publicOrderStatus(order) {
  const current = normalize(order?.status, 'pending');
  const payment = normalize(order?.payment_status, 'pending');

  if (REFUNDED_PAYMENT_STATUSES.has(payment)) return 'refunded';
  if (CANCELLED_PAYMENT_STATUSES.has(payment)) return 'cancelled';

  if (payment !== 'approved') {
    return current === 'cancelled' ? 'cancelled' : 'pending';
  }

  if (['cancelled', 'refunded'].includes(current)) return current;
  return PAID_OPERATIONAL_STATUSES.has(current) ? current : 'approved';
}

function orderStatusFromShipping(order, proposedStatus) {
  const current = normalize(order?.status, 'pending');
  const payment = normalize(order?.payment_status, 'pending');
  const proposed = normalize(proposedStatus, current);

  if (current === 'refunded' || REFUNDED_PAYMENT_STATUSES.has(payment)) return 'refunded';
  if (current === 'cancelled' || CANCELLED_PAYMENT_STATUSES.has(payment)) return 'cancelled';
  if (payment !== 'approved') return current;
  if (!(proposed in FULFILLMENT_RANK)) return current;

  const currentRank = FULFILLMENT_RANK[current] || 0;
  const proposedRank = FULFILLMENT_RANK[proposed];
  return proposedRank > currentRank ? proposed : current;
}

function shippingStatusFromProvider(currentStatus, proposedStatus) {
  const current = normalize(currentStatus, 'not_shipped');
  const proposed = normalize(proposedStatus, current);

  if (current === 'delivered' || proposed === 'delivered') return 'delivered';
  if (current === 'in_transit' && proposed === 'preparing') return 'in_transit';
  if (current === 'exception' && proposed === 'preparing') return 'exception';
  return proposed;
}

function adminStatusError({ currentStatus, targetStatus, paymentId, paymentStatus }) {
  const current = normalize(currentStatus, 'pending');
  const target = normalize(targetStatus);
  const payment = normalize(paymentStatus, 'pending');

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

  if (target === 'pending' && (payment === 'approved' || CANCELLED_PAYMENT_STATUSES.has(payment) || REFUNDED_PAYMENT_STATUSES.has(payment))) {
    return 'Un pago con estado definitivo en Mercado Pago no puede volver manualmente a pendiente.';
  }

  return null;
}

function adminStatusOptions(order) {
  const current = normalize(order?.status, 'pending');
  const payment = normalize(order?.payment_status, 'pending');
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
  FULFILLMENT_STATUSES,
  REFUNDED_PAYMENT_STATUSES,
  CANCELLED_PAYMENT_STATUSES,
  orderStatusFromPayment,
  publicOrderStatus,
  orderStatusFromShipping,
  shippingStatusFromProvider,
  adminStatusError,
  adminStatusOptions
};
