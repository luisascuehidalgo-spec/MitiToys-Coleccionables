const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { paymentsRequireReservation, PREFERENCE_TTL_MS } = require('../lib/payments');

const envios = fs.readFileSync(path.join(__dirname, '..', 'api', 'envios.js'), 'utf8');

test('sin pagos encontrados no se conserva una reserva vencida', () => {
  assert.equal(paymentsRequireReservation([]), false);
  assert.equal(paymentsRequireReservation(null), false);
});

test('solo intentos rechazados o cancelados no bloquean liberación de stock', () => {
  assert.equal(paymentsRequireReservation([{ status: 'rejected' }]), false);
  assert.equal(paymentsRequireReservation([{ status: 'cancelled' }]), false);
  assert.equal(paymentsRequireReservation([{ status: 'canceled' }]), false);
  assert.equal(paymentsRequireReservation([{ status: 'rejected' }, { status: 'cancelled' }]), false);
});

test('cualquier intento vivo o financiero conserva la reserva', () => {
  for (const status of ['pending', 'in_process', 'in_mediation', 'approved', 'authorized', 'refunded', 'charged_back']) {
    assert.equal(paymentsRequireReservation([{ status }]), true, `${status} debe conservar la reserva`);
  }
  assert.equal(paymentsRequireReservation([{ status: 'rejected' }, { status: 'pending' }]), true);
  assert.equal(paymentsRequireReservation([{ status: 'cancelled' }, { status: 'approved' }]), true);
});

test('estado desconocido se trata de forma conservadora y nunca libera stock', () => {
  assert.equal(paymentsRequireReservation([{ status: 'future_provider_state' }]), true);
  assert.equal(paymentsRequireReservation([{}]), true);
});

test('cron usa clasificación de intentos en ambos caminos de expiración', () => {
  assert.match(envios, /findPaymentsByExternalReference, findPreferenceByExternalReference, paymentsRequireReservation, PREFERENCE_TTL_MS/);
  const matches = envios.match(/paymentsRequireReservation\(payments\)/g) || [];
  assert.equal(matches.length, 2, 'La preferencia incierta y el checkout vencido deben compartir la misma clasificación segura.');
  assert.doesNotMatch(envios, /if \(payments\.length\) continue/);
  assert.doesNotMatch(envios, /if \(payments\.length\) \{/);
});

test('checkout normal mantiene 24h de vigencia y el cleanup agrega margen antes de liberar', () => {
  assert.equal(PREFERENCE_TTL_MS, 24 * 60 * 60 * 1000);
  assert.match(envios, /created_at < NOW\(\)-INTERVAL '26 hours'/);
});

test('liberación ocurre solo después del claim atómico del pedido pendiente', () => {
  const expiredStart = envios.indexOf('const expired = await sql`');
  const claimed = envios.indexOf("UPDATE orders SET status='cancelled',payment_status='expired'", expiredStart);
  const released = envios.indexOf("releaseReservedStock(sql, order.id, 'Liberación por checkout vencido')", expiredStart);
  assert.ok(expiredStart >= 0 && claimed > expiredStart && released > claimed);
  const claimBlock = envios.slice(claimed, released);
  assert.match(claimBlock, /status='pending'/);
  assert.match(claimBlock, /payment_id IS NULL/);
  assert.match(claimBlock, /COALESCE\(payment_status,'pending'\)='pending'/);
  assert.match(claimBlock, /RETURNING id/);
});
