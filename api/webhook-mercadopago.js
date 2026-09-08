const crypto = require('crypto');
const { getDb } = require('../lib/db');
const { searchParams } = require('../lib/request-url');
const { releaseReservedStockIfUnshipped } = require('../lib/inventory');
const { orderStatusFromPayment, isLateApprovalConflict } = require('../lib/order-state');
const { getPayment } = require('../lib/payments');
const { paymentIdentityDecision } = require('../lib/payment-reconciliation');
const { queueAndSendOrderNotification } = require('../lib/notifications');

function parseSignatureHeader(value) {
  const parts = {};
  for (const item of String(value || '').split(',')) {
    const [key, ...rest] = item.split('=');
    if (key && rest.length) parts[key.trim()] = rest.join('=').trim();
  }
  return parts;
}

function isValidSignature(req, id) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return false;
  const { ts, v1 } = parseSignatureHeader(req.headers['x-signature'] || '');
  const requestId = req.headers['x-request-id'] || '';
  if (!ts || !v1) return false;
  const manifest = `id:${String(id).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch (_) {
    return false;
  }
}

function paymentMatchesOrder(payment, order) {
  const expectedAmount = Number(order.total_amount);
  const receivedAmount = Number(payment.transaction_amount);
  const amountOk = Number.isFinite(expectedAmount)
    && Number.isFinite(receivedAmount)
    && Math.abs(expectedAmount - receivedAmount) < 0.01;
  const currencyOk = !payment.currency_id || String(payment.currency_id) === String(order.currency || 'ARS');
  return amountOk && currencyOk;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const body = req.body || {};
    const query = searchParams(req);
    const dataId = body?.data?.id || query.get('data.id') || query.get('id');
    const type = body?.type || query.get('type');

    if (type !== 'payment' && body?.action !== 'payment.created' && body?.action !== 'payment.updated') {
      return res.status(200).json({ received: true, ignored: true });
    }
    if (!dataId) return res.status(400).json({ error: 'Falta data.id' });
    if (!isValidSignature(req, dataId)) return res.status(401).json({ error: 'Firma de Webhook inválida o clave no configurada.' });
    if (body?.live_mode === false) return res.status(200).json({ received: true, simulated: true });

    let payment;
    try {
      payment = await getPayment(dataId);
    } catch (error) {
      if (error?.code === 'MP_NOT_CONFIGURED') {
        return res.status(500).json({ error: 'Falta configurar MERCADOPAGO_ACCESS_TOKEN.' });
      }
      console.error(
        'Error consultando pago en Mercado Pago:',
        'code=' + String(error?.code || 'MP_PAYMENT_LOOKUP_FAILED'),
        'status=' + String(error?.providerStatus || 'unknown')
      );
      return res.status(502).json({ error: 'No se pudo consultar el pago.' });
    }

    if (process.env.DATABASE_URL && payment.external_reference) {
      const sql = getDb();
      const rows = await sql`
        SELECT id,status,customer_id,quantity,product_id,total_amount,currency,
               payment_id,payment_status,payment_status_detail
        FROM orders WHERE external_reference=${payment.external_reference} LIMIT 1
      `;

      if (rows.length) {
        const order = rows[0];
        const paymentId = String(payment.id || dataId);
        const ownership = await sql`
          SELECT id FROM orders
          WHERE payment_id=${paymentId} AND id<>${order.id}
          LIMIT 1
        `;

        if (ownership.length) {
          const conflictingOrderId = String(ownership[0].id);
          await sql`
            INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)
            SELECT
              ${order.id},'payment.ownership_conflict',${order.status},${order.status},
              ${JSON.stringify({
                payment_id: paymentId,
                conflicting_order_id: ownership[0].id,
                external_reference: payment.external_reference
              })}::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM order_events
              WHERE order_id=${order.id}
                AND event_type='payment.ownership_conflict'
                AND payload->>'payment_id'=${paymentId}
                AND payload->>'conflicting_order_id'=${conflictingOrderId}
            )
          `;
          console.error(
            'Mercado Pago payment ownership conflict:',
            'code=PAYMENT_OWNERSHIP_CONFLICT',
            'order_id=' + String(order.id)
          );
          return res.status(200).json({ received: true, ownership_conflict: true });
        }

        const identityDecision = paymentIdentityDecision(order, payment);
        const currentPaymentId = String(order.payment_id || '').trim();
        const incomingPaymentStatus = String(payment.status || '').trim().toLowerCase();

        if (identityDecision === 'ignore_secondary') {
          const ignoredEvents = await sql`
            INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)
            SELECT
              ${order.id},'payment.secondary_attempt_ignored',${order.status},${order.status},
              ${JSON.stringify({
                payment_id: paymentId,
                status: incomingPaymentStatus || null,
                status_detail: payment.status_detail || null,
                current_payment_id: currentPaymentId,
                current_payment_status: order.payment_status || null,
                reason: 'different_non_approved_payment'
              })}::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM order_events
              WHERE order_id=${order.id}
                AND event_type='payment.secondary_attempt_ignored'
                AND payload->>'payment_id'=${paymentId}
                AND COALESCE(payload->>'status','')=${incomingPaymentStatus}
            )
            RETURNING id
          `;
          return res.status(200).json({
            received: true,
            payment_id: payment.id,
            status: payment.status,
            secondary_payment_ignored: true,
            duplicate: ignoredEvents.length === 0
          });
        }

        if (identityDecision === 'multiple_approved_conflict') {
          const amountMatchesOrder = paymentMatchesOrder(payment, order);
          await sql`
            UPDATE orders SET payment_status_detail='multiple_approved_conflict',updated_at=NOW()
            WHERE id=${order.id}
              AND payment_status_detail IS DISTINCT FROM 'multiple_approved_conflict'
          `;
          const conflictEvents = await sql`
            INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)
            SELECT
              ${order.id},'payment.multiple_approved_conflict',${order.status},${order.status},
              ${JSON.stringify({
                payment_id: paymentId,
                provider_status: payment.status || null,
                provider_status_detail: payment.status_detail || null,
                transaction_amount: payment.transaction_amount,
                currency_id: payment.currency_id || null,
                amount_and_currency_match: amountMatchesOrder,
                current_payment_id: currentPaymentId,
                current_payment_status: order.payment_status || null,
                current_payment_status_detail: order.payment_status_detail || null,
                reason: 'different_approved_payment'
              })}::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM order_events
              WHERE order_id=${order.id}
                AND event_type='payment.multiple_approved_conflict'
                AND payload->>'payment_id'=${paymentId}
            )
            RETURNING id
          `;
          console.error(
            'Mercado Pago multiple approved payment conflict:',
            'code=MULTIPLE_APPROVED_PAYMENT_CONFLICT',
            'order_id=' + String(order.id)
          );
          return res.status(200).json({
            received: true,
            payment_id: payment.id,
            status: payment.status,
            multiple_approved_conflict: true,
            duplicate: conflictEvents.length === 0
          });
        }

        let customerId = order.customer_id;
        const payer = payment.payer || {};
        const email = String(payer.email || '').trim().toLowerCase();
        const first = String(payer.first_name || '').trim();
        const last = String(payer.last_name || '').trim();
        const name = ([first, last].filter(Boolean).join(' ') || 'Cliente Mercado Pago').slice(0, 120);
        const phone = String(payer.phone?.number || '').trim().slice(0, 50);

        if (!customerId && email && /^\S+@\S+\.\S+$/.test(email)) {
          const customers = await sql`
            INSERT INTO customers(name,email,phone)
            VALUES(${name},${email},${phone || null})
            ON CONFLICT(email) DO UPDATE SET
              name=EXCLUDED.name,
              phone=COALESCE(EXCLUDED.phone,customers.phone)
            RETURNING id
          `;
          customerId = customers[0].id;
        }

        if (customerId && String(order.customer_id || '') !== String(customerId)) {
          await sql`
            UPDATE orders SET customer_id=${customerId},updated_at=NOW()
            WHERE id=${order.id} AND customer_id IS DISTINCT FROM ${customerId}
          `;
        }

        const oldStatus = order.status;
        const preservePaymentConflict = order.payment_status_detail === 'multiple_approved_conflict';
        const approvedMismatch = payment.status === 'approved' && !paymentMatchesOrder(payment, order);

        if (approvedMismatch) {
          const validationDetail = preservePaymentConflict ? 'multiple_approved_conflict' : 'amount_or_currency_mismatch';
          const validationRows = await sql`
            UPDATE orders SET
              payment_id=${paymentId},
              payment_status='validation_failed',
              payment_status_detail=${validationDetail},
              updated_at=NOW()
            WHERE id=${order.id}
              AND (
                payment_id IS DISTINCT FROM ${paymentId}
                OR payment_status IS DISTINCT FROM 'validation_failed'
                OR payment_status_detail IS DISTINCT FROM ${validationDetail}
              )
            RETURNING id
          `;
          if (validationRows.length) {
            await sql`
              INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)
              VALUES(
                ${order.id},'payment.validation_failed',${oldStatus},${oldStatus},
                ${JSON.stringify({
                  payment_id: paymentId,
                  provider_status: payment.status,
                  provider_status_detail: payment.status_detail || null,
                  transaction_amount: payment.transaction_amount,
                  currency_id: payment.currency_id || null,
                  expected_amount: Number(order.total_amount),
                  expected_currency: order.currency || 'ARS',
                  reason: 'amount_or_currency_mismatch'
                })}::jsonb
              )
            `;
            console.error('Mercado Pago payment validation failed:', 'order_id=' + String(order.id));
          }
          return res.status(200).json({ received: true, payment_id: payment.id, status: payment.status, validation_failed: true, duplicate: validationRows.length === 0 });
        }

        if (isLateApprovalConflict(oldStatus, payment.status)) {
          const lateApprovalDetail = preservePaymentConflict ? 'multiple_approved_conflict' : 'late_approval_conflict';
          const lateConflictRows = await sql`
            UPDATE orders SET
              payment_id=${paymentId},payment_status='approved',
              payment_status_detail=${lateApprovalDetail},status=${oldStatus},updated_at=NOW()
            WHERE id=${order.id}
              AND (
                payment_id IS DISTINCT FROM ${paymentId}
                OR payment_status IS DISTINCT FROM 'approved'
                OR payment_status_detail IS DISTINCT FROM ${lateApprovalDetail}
              )
            RETURNING id
          `;

          if (lateConflictRows.length) {
            await sql`
              INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)
              VALUES(
                ${order.id},'payment.late_approval_conflict',${oldStatus},${oldStatus},
                ${JSON.stringify({
                  payment_id: paymentId,
                  provider_status: payment.status,
                  provider_status_detail: payment.status_detail || null,
                  transaction_amount: payment.transaction_amount,
                  currency_id: payment.currency_id || null,
                  reason: 'approved_after_terminal_order'
                })}::jsonb
              )
            `;
            console.error(
              'Mercado Pago late approval conflict:',
              'code=LATE_PAYMENT_APPROVAL_CONFLICT',
              'order_id=' + String(order.id)
            );
          }

          return res.status(200).json({
            received: true,
            payment_id: payment.id,
            status: payment.status,
            late_approval_conflict: true,
            duplicate: lateConflictRows.length === 0
          });
        }

        const newStatus = orderStatusFromPayment(oldStatus, payment.status);
        const providerPaymentStatus = payment.status || null;
        const providerPaymentStatusDetail = preservePaymentConflict
          ? 'multiple_approved_conflict'
          : (payment.status_detail || null);
        const paymentUpdateRows = await sql`
          UPDATE orders SET
            payment_id=${paymentId},
            payment_status=${providerPaymentStatus},payment_status_detail=${providerPaymentStatusDetail},
            status=${newStatus},updated_at=NOW()
          WHERE id=${order.id}
            AND (
              payment_id IS DISTINCT FROM ${paymentId}
              OR payment_status IS DISTINCT FROM ${providerPaymentStatus}
              OR payment_status_detail IS DISTINCT FROM ${providerPaymentStatusDetail}
              OR status IS DISTINCT FROM ${newStatus}
            )
          RETURNING id
        `;
        const duplicateSnapshot = paymentUpdateRows.length === 0;

        let stockRelease = null;
        if (newStatus === 'cancelled' || newStatus === 'refunded') {
          stockRelease = await releaseReservedStockIfUnshipped(
            sql,
            order.id,
            newStatus === 'refunded' ? 'Liberación por reembolso' : 'Liberación por rechazo/cancelación'
          );
        }

        const eventStatus = String(payment.status || '');
        const eventStatusDetail = String(payment.status_detail || '');
        const paymentEventType = ['payment.created', 'payment.updated'].includes(body.action)
          ? body.action
          : 'payment.notification';
        const paymentEventRows = await sql`
          INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)
          SELECT
            ${order.id},${paymentEventType},${oldStatus},${newStatus},
            ${JSON.stringify({
              payment_id: paymentId,
              status: payment.status,
              status_detail: payment.status_detail,
              transaction_amount: payment.transaction_amount,
              currency_id: payment.currency_id || null,
              stock_release: stockRelease
            })}::jsonb
          WHERE NOT EXISTS (
            SELECT 1 FROM order_events
            WHERE order_id=${order.id}
              AND event_type IN ('payment.created','payment.updated','payment.notification')
              AND payload->>'payment_id'=${paymentId}
              AND COALESCE(payload->>'status','')=${eventStatus}
              AND COALESCE(payload->>'status_detail','')=${eventStatusDetail}
          )
          RETURNING id
        `;

        let notificationType = null;
        if (providerPaymentStatus === 'approved' && newStatus === 'approved') notificationType = 'payment_approved';
        if (['cancelled','rejected'].includes(String(providerPaymentStatus || '')) && newStatus === 'cancelled') notificationType = 'order_cancelled';
        if (['refunded','charged_back'].includes(String(providerPaymentStatus || '')) && newStatus === 'refunded') notificationType = 'order_refunded';
        if (notificationType) await queueAndSendOrderNotification(sql, order.id, notificationType);

        return res.status(200).json({
          received: true,
          payment_id: payment.id,
          status: payment.status,
          duplicate: duplicateSnapshot,
          event_recovered: duplicateSnapshot && paymentEventRows.length > 0
        });
      } else {
        console.warn('Webhook recibido sin pedido asociado:', String(payment.external_reference).slice(0, 120));
      }
    }

    return res.status(200).json({ received: true, payment_id: payment.id, status: payment.status });
  } catch (error) {
    const constraint = String(error?.constraint || '');
    if (error?.code === '23505' && /orders_payment_id_unique|payment_id/i.test(constraint)) {
      console.error('Mercado Pago payment ownership conflict:', 'code=PAYMENT_OWNERSHIP_CONFLICT');
      return res.status(200).json({ received: true, ownership_conflict: true });
    }

    console.error(
      'Webhook Mercado Pago error:',
      'code=' + String(error?.code || error?.name || 'WEBHOOK_ERROR'),
      'status=' + String(error?.providerStatus || error?.status || 'unknown')
    );
    return res.status(500).json({ error: 'Error procesando el Webhook.' });
  }
};
