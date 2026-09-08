const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isLateApprovalConflict,
  adminStatusError,
  adminStatusOptions
} = require('../lib/order-state');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('approved sobre pedido terminal se clasifica como conflicto tardío', () => {
  assert.equal(isLateApprovalConflict('cancelled', 'approved'), true);
  assert.equal(isLateApprovalConflict('refunded', 'approved'), true);
  assert.equal(isLateApprovalConflict('pending', 'approved'), false);
  assert.equal(isLateApprovalConflict('cancelled', 'refunded'), false);
});

test('admin nunca puede revivir cancelled/refunded aunque payment_status sea approved', () => {
  for (const currentStatus of ['cancelled', 'refunded']) {
    for (const targetStatus of ['approved', 'processing', 'shipped', 'delivered']) {
      assert.match(
        adminStatusError({
          currentStatus,
          targetStatus,
          paymentId: 'mp-1',
          paymentStatus: 'approved'
        }),
        /no puede reactivarse/i
      );
    }
  }

  assert.deepEqual(
    adminStatusOptions({ status: 'cancelled', payment_status: 'approved', payment_id: 'mp-1' }),
    ['cancelled']
  );
  assert.deepEqual(
    adminStatusOptions({ status: 'refunded', payment_status: 'refunded', payment_id: 'mp-1' }),
    ['refunded']
  );
});

test('webhook registra el conflicto sin reactivar ni liberar stock', () => {
  const webhook = read('api/webhook-mercadopago.js');
  const start = webhook.indexOf('if (isLateApprovalConflict(oldStatus, payment.status))');
  const end = webhook.indexOf('const newStatus = orderStatusFromPayment', start);
  assert.ok(start >= 0 && end > start, 'No se encontró el bloque de pago tardío antes del flujo normal.');
  const block = webhook.slice(start, end);

  assert.match(block, /payment_status='approved'/);
  assert.match(block, /payment_status_detail='late_approval_conflict'/);
  assert.match(block, /status=\$\{oldStatus\}/);
  assert.match(block, /payment_status_detail IS DISTINCT FROM 'late_approval_conflict'/);
  assert.match(block, /RETURNING id/);
  assert.match(block, /if \(lateConflictRows\.length\)/);
  assert.match(block, /payment\.late_approval_conflict/);
  assert.match(block, /duplicate: lateConflictRows\.length === 0/);
  assert.match(block, /late_approval_conflict: true/);
  assert.doesNotMatch(block, /releaseReservedStock/);
  assert.doesNotMatch(block, /queueAndSendOrderNotification/);
});

test('panel destaca el conflicto y no ofrece generar envío para terminales', () => {
  const admin = read('admin.html');
  assert.match(admin, /late_approval_conflict/);
  assert.match(admin, /PAGO APROBADO DESPUÉS DEL CIERRE/);
  assert.match(admin, /!\['cancelled','refunded'\]\.includes\(String\(o\.status\|\|''\)\)/);
});
