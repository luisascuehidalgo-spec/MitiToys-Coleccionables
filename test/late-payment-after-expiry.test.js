const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isLateApprovalConflict, orderStatusFromPayment, adminStatusError } = require('../lib/order-state');

const root = path.join(__dirname, '..');
const envios = fs.readFileSync(path.join(root, 'api', 'envios.js'), 'utf8');
const webhook = fs.readFileSync(path.join(root, 'api', 'webhook-mercadopago.js'), 'utf8');

test('un pago pendiente posterior a la expiración no revive el pedido cancelado', () => {
  assert.equal(orderStatusFromPayment('cancelled', 'pending'), 'cancelled');
  assert.equal(orderStatusFromPayment('cancelled', 'in_process'), 'cancelled');
  assert.equal(orderStatusFromPayment('cancelled', 'rejected'), 'cancelled');
});

test('un approved posterior a la expiración se clasifica como conflicto tardío', () => {
  assert.equal(isLateApprovalConflict('cancelled', 'approved'), true);
  assert.match(webhook, /isLateApprovalConflict\(oldStatus, payment\.status\)/);
  assert.match(webhook, /payment_status='approved'[\s\S]*payment_status_detail=\$\{lateApprovalDetail\}[\s\S]*status=\$\{oldStatus\}/);
  assert.match(webhook, /payment\.late_approval_conflict/);
  assert.match(webhook, /late_approval_conflict: true/);
});

test('cron no puede cancelar si el webhook ganó la carrera y ya persistió payment_id', () => {
  const expiredStart = envios.indexOf('const expired = await sql`');
  const claim = envios.indexOf("UPDATE orders SET status='cancelled',payment_status='expired'", expiredStart);
  const release = envios.indexOf("releaseReservedStock(sql, order.id, 'Liberación por checkout vencido')", expiredStart);
  assert.ok(expiredStart >= 0 && claim > expiredStart && release > claim);
  const claimBlock = envios.slice(claim, release);
  assert.match(claimBlock, /payment_id IS NULL/);
  assert.match(claimBlock, /status='pending'/);
  assert.match(claimBlock, /COALESCE\(payment_status,'pending'\)='pending'/);
  assert.match(claimBlock, /RETURNING id/);
  assert.match(envios.slice(release - 120, release), /if \(!claimed\.length\) continue/);
});

test('si el cron gana primero, el webhook conserva cancelled y exige revisión en vez de despachar', () => {
  assert.match(webhook, /const oldStatus = order\.status/);
  const lateStart = webhook.indexOf('if (isLateApprovalConflict(oldStatus, payment.status))');
  const lateEnd = webhook.indexOf('const newStatus = orderStatusFromPayment', lateStart);
  assert.ok(lateStart >= 0 && lateEnd > lateStart);
  const block = webhook.slice(lateStart, lateEnd);
  assert.match(block, /status=\$\{oldStatus\}/);
  assert.doesNotMatch(block, /releaseReservedStock/);
  assert.doesNotMatch(block, /queueAndSendOrderNotification/);

  assert.match(
    adminStatusError({
      currentStatus: 'cancelled',
      targetStatus: 'processing',
      paymentId: 'late-payment',
      paymentStatus: 'approved',
      paymentStatusDetail: 'late_approval_conflict'
    }),
    /no puede reactivarse/i
  );
});

test('el stock liberado no se vuelve a sumar por un evento financiero terminal posterior', () => {
  const inventory = fs.readFileSync(path.join(root, 'lib', 'inventory.js'), 'utf8');
  assert.match(inventory, /ON CONFLICT \(order_id,product_id,movement_type\)[\s\S]*DO NOTHING/);
  assert.match(inventory, /movement_type='release'/);
});
