const crypto = require('crypto');
const { getDb } = require('../lib/db');
const { searchParams } = require('../lib/request-url');
const { releaseReservedStockIfUnshipped } = require('../lib/inventory');
const { orderStatusFromPayment, isLateApprovalConflict } = require('../lib/order-state');
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

    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'Falta configurar MERCADOPAGO_ACCESS_TOKEN.' });

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const payment = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok) {
      console.error('Error consultando pago en Mercado Pago:', 'status=' + String(paymentResponse.status));
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
          await sql`
            INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)
            VALUES(
              ${order.id},'payment.ownership_conflict',${order.status},${order.status},
              ${JSON.stringify({
                payment_id: paymentId,
                conflicting_order_id: ownership[0].id,
                external_reference: payment.external_reference
              })}::jsonb
            )
          `;
          console.error(
            'Mercado Pago payment ownership conflict:',
            'code=PAYMENT_OWNERSHIP_CONFLICT',
            'order_id=' + String(order.id)
          );
          return res.status(200).json({ received: true, ownership_conflict: true });
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

        const oldStatus = order.status;
        const approvedMismatch = payment.status === 'approved' && !paymentMatchesOrder(payment, order);

        if (approvedMismatch) {
          await sql`
            UPDATE orders SET
              customer_id=${customerId},
              payment_id=${paymentId},
              payment_status='validation_failed',
              payment_status_detail='amount_or_currency_mismatch',
              updated_at=NOW()
            WHERE id=${order.id}
          `;
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
          return res.status(200).json({ received: true, payment_id: payment.id, status: payment.status, validation_failed: true });
        }

        if (isLateApprovalConflict(oldStatus, payment.status)) {
          const alreadyMarked = order.payment_status === 'approved'
            && order.payment_status_detail === 'late_approval_conflict'
            && String(order.payment_id || '') === paymentId;

          await sql`
            UPDATE orders SET
              customer_id=${customerId},payment_id=${paymentId},payment_status='approved',
              payment_status_detail='late_approval_conflict',status=${oldStatus},updated_at=NOW()
            WHERE id=${order.id}
          `;

          if (!alreadyMarked) {
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
            late_approval_conflict: true
          });
        }

        const newStatus = orderStatusFromPayment(oldStatus, payment.status);
        await sql`
          UPDATE orders SET
            customer_id=${customerId},payment_id=${paymentId},
            payment_status=${payment.status || null},payment_status_detail=${payment.status_detail || null},
            status=${newStatus},updated_at=NOW()
          WHERE id=${order.id}
        `;

        let stockRelease = null;
        if (newStatus === 'cancelled' || newStatus === 'refunded') {
          stockRelease = await releaseReservedStockIfUnshipped(
            sql,
            order.id,
            newStatus === 'refunded' ? 'Liberación por reembolso' : 'Liberación por rechazo/cancelación'
          );
        }

        await sql`
          INSERT INTO order_events(order_id,event_type,old_status,new_status,payload)
          VALUES(
            ${order.id},${body.action || 'payment.notification'},${oldStatus},${newStatus},
            ${JSON.stringify({
              payment_id: paymentId,
              status: payment.status,
              status_detail: payment.status_detail,
              transaction_amount: payment.transaction_amount,
              currency_id: payment.currency_id || null,
              stock_release: stockRelease
            })}::jsonb
          )
        `;

        if (oldStatus !== newStatus) {
          const notificationType = {
            approved: 'payment_approved',
            cancelled: 'order_cancelled',
            refunded: 'order_refunded'
          }[newStatus];
          if (notificationType) await queueAndSendOrderNotification(sql, order.id, notificationType);
        }
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
