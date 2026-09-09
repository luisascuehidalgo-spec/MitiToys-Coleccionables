const { requiresPaymentReview } = require('./order-state');

const SITE_URL = 'https://mititoys.com';
const AUTO_TERMINAL_NOTIFICATION_STATUSES = new Set(['sent', 'sending', 'delivery_uncertain', 'failed', 'superseded']);
const RESEND_IMMEDIATE_ATTEMPTS = 2;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const validEmail = value => {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};

function senderEmail() {
  const from = String(process.env.MITITOYS_FROM_EMAIL || '').trim();
  const bracketed = from.match(/<([^<>]+)>/);
  return validEmail(bracketed ? bracketed[1] : from);
}

function emailEnabled() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MITITOYS_FROM_EMAIL);
}

async function orderContext(sql, orderId) {
  const rows = await sql`
    SELECT o.*,c.name AS customer_name,c.email AS customer_email
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
    WHERE o.id=${orderId} LIMIT 1
  `;
  if (!rows.length || !rows[0].customer_email) return null;
  const items = await sql`SELECT product_id,product_title,quantity FROM order_items WHERE order_id=${orderId} ORDER BY id`;
  const reviews = await sql`SELECT product_id,review_token FROM reviews WHERE order_id=${orderId} ORDER BY id`;
  return { order: rows[0], items, reviews };
}

function normalize(value, fallback = '') {
  return String(value ?? fallback).trim().toLowerCase();
}

function notificationAllowed(type, order) {
  const status = normalize(order?.status, 'pending');
  const payment = normalize(order?.payment_status, 'pending');
  const needsReview = requiresPaymentReview(order);

  if (type === 'payment_approved') {
    return payment === 'approved' && !needsReview && status === 'approved';
  }
  if (type === 'order_processing') {
    return payment === 'approved' && !needsReview && status === 'processing';
  }
  if (type === 'shipment_created') {
    return payment === 'approved'
      && !needsReview
      && ['processing', 'shipped'].includes(status)
      && Boolean(order?.enviopack_shipment_id || order?.tracking_number);
  }
  if (type === 'order_delivered' || type === 'review_invite') {
    return payment === 'approved' && !needsReview && status === 'delivered';
  }
  if (type === 'order_cancelled') {
    return status === 'cancelled' && ['pending', 'cancelled', 'rejected', 'expired'].includes(payment);
  }
  if (type === 'order_refunded') {
    return status === 'refunded' && ['refunded', 'charged_back'].includes(payment);
  }
  if (type === 'abandoned_checkout') {
    return status === 'pending'
      && payment === 'pending'
      && Boolean(order?.payment_url);
  }
  return false;
}

function emailContent(type, context) {
  const { order, items, reviews } = context;
  const name = escapeHtml(order.customer_name || order.shipping_recipient || 'Coleccionista');
  const orderNumber = escapeHtml(order.order_number);
  const trackUrl = `${SITE_URL}/pedido.html?pedido=${encodeURIComponent(order.order_number)}`;
  const shell = (title, lead, body, buttonText, buttonUrl) => ({
    subject: title,
    html: `<!doctype html><html><body style="margin:0;background:#070707;color:#fff;font-family:Arial,sans-serif"><div style="max-width:620px;margin:auto;padding:30px 18px"><div style="background:#121212;border:1px solid #292929;border-radius:18px;padding:28px"><div style="font-size:26px;font-weight:900;color:#ffd21c">Mititoys coleccionables</div><h1 style="font-size:25px;margin:25px 0 10px">${escapeHtml(title)}</h1><p style="color:#ccc;line-height:1.6">Hola ${name}, ${escapeHtml(lead)}</p>${body}<a href="${escapeHtml(buttonUrl)}" style="display:inline-block;margin-top:20px;background:#ef2525;color:#fff;text-decoration:none;font-weight:900;padding:13px 18px;border-radius:9px">${escapeHtml(buttonText)}</a><p style="margin-top:24px;color:#888;font-size:12px">Pedido ${orderNumber} · Este email fue generado automáticamente por Mititoys.</p></div></div></body></html>`
  });
  const itemList = `<ul style="color:#ddd;line-height:1.7">${items.map(item => `<li>${escapeHtml(item.product_title)} × ${Number(item.quantity || 1)}</li>`).join('')}</ul>`;

  if (type === 'payment_approved') {
    return shell('Pago aprobado', 'recibimos correctamente tu pago y tu pedido ya ingresó a preparación.', itemList, 'VER MI PEDIDO', trackUrl);
  }
  if (type === 'shipment_created') {
    const carrier = escapeHtml(order.shipping_carrier || 'el correo seleccionado');
    const tracking = order.tracking_number ? `<p style="color:#ddd"><b>Seguimiento:</b> ${escapeHtml(order.tracking_number)}</p>` : '';
    return shell('Tu pedido está listo para despachar', `preparamos el envío con ${carrier}.`, tracking + itemList, 'SEGUIR ENVÍO', trackUrl);
  }
  if (type === 'order_processing') {
    return shell('Estamos preparando tu pedido', 'tu compra ya está siendo preparada con cuidado para el envío.', itemList, 'VER MI PEDIDO', trackUrl);
  }
  if (type === 'order_delivered') {
    return shell('Tu pedido fue entregado', 'Envíopack informó que tu pedido ya fue entregado. Esperamos que disfrutes mucho tus figuras.', itemList, 'VER MI PEDIDO', trackUrl);
  }
  if (type === 'order_cancelled') {
    return shell('Actualización sobre tu pedido', 'tu pedido fue cancelado. Si necesitás ayuda, respondé directamente este correo.', itemList, 'VER MI PEDIDO', trackUrl);
  }
  if (type === 'order_refunded') {
    return shell('Tu pago fue reembolsado', 'el reembolso de tu compra fue registrado. La acreditación puede depender del medio de pago.', itemList, 'VER MI PEDIDO', trackUrl);
  }
  if (type === 'abandoned_checkout') {
    return shell('Tu carrito de Mititoys te está esperando', 'tu pedido quedó pendiente de pago. Si todavía querés estas figuras, podés retomarlo desde el botón.', itemList, 'RETOMAR PAGO', order.payment_url || SITE_URL + '/carrito.html');
  }
  if (type === 'review_invite') {
    const links = reviews.map((review, index) => {
      const item = items.find(candidate => String(candidate.product_id) === String(review.product_id));
      const url = `${SITE_URL}/opinar.html#token=${encodeURIComponent(review.review_token)}`;
      return `<p><a href="${escapeHtml(url)}" style="color:#ffd21c;font-weight:800">Opinar sobre ${escapeHtml(item?.product_title || 'tu figura ' + (index + 1))}</a></p>`;
    }).join('');
    return shell('¿Cómo fue tu compra?', 'tu opinión ayuda a otros coleccionistas. El enlace está habilitado únicamente para productos que compraste.', links, 'VER MI PEDIDO', trackUrl);
  }
  return null;
}

function terminalNotificationResult(notification) {
  const status = String(notification?.status || '');
  if (!AUTO_TERMINAL_NOTIFICATION_STATUSES.has(status)) return null;
  if (status === 'sent') {
    return { sent: false, reason: 'already_sent', id: notification.provider_id || null };
  }
  if (status === 'sending') {
    return { sent: false, reason: 'in_flight', id: notification.provider_id || null };
  }
  return { sent: false, reason: status, id: notification.provider_id || null };
}

async function insertOrderNotification(sql, context, orderId, type, scheduledAt) {
  const key = `${type}:${orderId}`;
  const rows = await sql`
    INSERT INTO notifications(order_id,type,recipient,idempotency_key,scheduled_at)
    VALUES(${orderId},${type},${context.order.customer_email},${key},${scheduledAt.toISOString()})
    ON CONFLICT(idempotency_key) DO UPDATE SET
      recipient=CASE
        WHEN notifications.status IN ('pending','pending_configuration') THEN EXCLUDED.recipient
        ELSE notifications.recipient
      END
    RETURNING *
  `;
  return rows[0] || null;
}

async function queueOrderNotification(sql, orderId, type, scheduledAt = new Date()) {
  const context = await orderContext(sql, orderId);
  if (!context || !notificationAllowed(type, context.order)) return null;
  if (type === 'review_invite' && notificationAllowed('order_delivered', context.order)) {
    await insertOrderNotification(sql, context, orderId, 'order_delivered', scheduledAt);
  }
  return insertOrderNotification(sql, context, orderId, type, scheduledAt);
}

function resendErrorCode(data) {
  return String(data?.name || data?.code || data?.error || '').trim().toLowerCase();
}

function retryableResendResponse(response, data) {
  if (!response) return false;
  if ([408, 425, 429].includes(Number(response.status)) || Number(response.status) >= 500) return true;
  return Number(response.status) === 409 && resendErrorCode(data) === 'concurrent_idempotent_requests';
}

function ambiguousResendResponse(response, data) {
  if (!response) return true;
  const status = Number(response.status);
  const code = resendErrorCode(data);
  return status === 408 || status >= 500 || (status === 409 && ['concurrent_idempotent_requests','invalid_idempotent_request'].includes(code));
}

async function updateNotificationFailure(sql, notification, { status, lastError, attempts }) {
  const rows = await sql`
    UPDATE notifications SET status=${status},last_error=${lastError},attempts=attempts+${attempts},updated_at=NOW()
    WHERE id=${notification.id} AND status IS DISTINCT FROM 'sent'
    RETURNING status,provider_id
  `;
  if (!rows.length || rows[0]?.status === 'sent') {
    return { sent: false, reason: 'already_sent', id: rows[0]?.provider_id || notification.provider_id || null };
  }
  return { sent: false, reason: status, id: rows[0]?.provider_id || null };
}

async function supersedeNotification(sql, notification) {
  const rows = await sql`
    UPDATE notifications SET status='superseded',
      last_error='El estado actual del pedido ya no corresponde a esta notificación.',updated_at=NOW()
    WHERE id=${notification.id} AND status='sending'
    RETURNING status,provider_id
  `;
  return { sent: false, reason: rows.length ? 'superseded' : 'not_claimed', id: rows[0]?.provider_id || null };
}

async function claimNotificationForSend(sql, notification) {
  const rows = await sql`
    UPDATE notifications SET status='sending',updated_at=NOW()
    WHERE id=${notification.id} AND status IN ('pending','pending_configuration')
    RETURNING *
  `;
  if (rows.length) return { claimed: true, notification: rows[0] };
  const current = await sql`SELECT status,provider_id FROM notifications WHERE id=${notification.id} LIMIT 1`;
  return { claimed: false, notification: { ...notification, ...(current[0] || {}) } };
}

async function sendNotification(sql, notification) {
  if (!notification) return { sent: false, reason: 'missing' };
  const terminal = terminalNotificationResult(notification);
  if (terminal) return terminal;
  if (!emailEnabled()) {
    await sql`UPDATE notifications SET status='pending_configuration',updated_at=NOW() WHERE id=${notification.id} AND status NOT IN ('sent','sending','delivery_uncertain','failed','superseded')`;
    return { sent: false, reason: 'not_configured' };
  }

  const claim = await claimNotificationForSend(sql, notification);
  if (!claim.claimed) {
    return terminalNotificationResult(claim.notification) || { sent: false, reason: 'not_claimed' };
  }
  const claimedNotification = claim.notification;
  const context = await orderContext(sql, claimedNotification.order_id);
  if (context && !notificationAllowed(claimedNotification.type, context.order)) {
    return supersedeNotification(sql, claimedNotification);
  }
  const content = context && emailContent(claimedNotification.type, context);
  if (!content) {
    return updateNotificationFailure(sql, claimedNotification, {
      status: 'failed',
      lastError: 'Plantilla o pedido no disponible',
      attempts: 1
    });
  }
  const replyTo = validEmail(process.env.MITITOYS_REPLY_TO_EMAIL) || senderEmail();
  const copyTo = validEmail(process.env.MITITOYS_EMAIL_COPY) || replyTo;
  const payload = {
    from: process.env.MITITOYS_FROM_EMAIL,
    to: [claimedNotification.recipient],
    subject: content.subject,
    html: content.html
  };
  if (replyTo) payload.reply_to = replyTo;
  if (copyTo && copyTo !== validEmail(claimedNotification.recipient)) payload.bcc = [copyTo];

  let providerAttempts = 0;
  for (let attempt = 0; attempt < RESEND_IMMEDIATE_ATTEMPTS; attempt += 1) {
    providerAttempts += 1;
    let response;
    let data = {};
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': claimedNotification.idempotency_key
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000)
      });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      if (attempt + 1 < RESEND_IMMEDIATE_ATTEMPTS) continue;
      return updateNotificationFailure(sql, claimedNotification, {
        status: 'delivery_uncertain',
        lastError: 'No se pudo confirmar si el proveedor aceptó el correo.',
        attempts: providerAttempts
      });
    }

    if (response.ok) {
      const rows = await sql`
        UPDATE notifications SET status='sent',provider_id=${String(data.id || '')},last_error=NULL,
          attempts=attempts+${providerAttempts},sent_at=COALESCE(sent_at,NOW()),updated_at=NOW()
        WHERE id=${claimedNotification.id}
        RETURNING provider_id
      `;
      return { sent: true, id: rows[0]?.provider_id || data.id || null };
    }

    if (retryableResendResponse(response, data) && attempt + 1 < RESEND_IMMEDIATE_ATTEMPTS) continue;

    if (ambiguousResendResponse(response, data)) {
      return updateNotificationFailure(sql, claimedNotification, {
        status: 'delivery_uncertain',
        lastError: `No se pudo confirmar la entrega del correo (HTTP ${Number(response.status) || 0}).`,
        attempts: providerAttempts
      });
    }

    return updateNotificationFailure(sql, claimedNotification, {
      status: 'failed',
      lastError: `Resend rechazó el correo (HTTP ${Number(response.status) || 0}).`,
      attempts: providerAttempts
    });
  }

  return { sent: false, reason: 'delivery_uncertain' };
}

async function queueAndSendOrderNotification(sql, orderId, type, scheduledAt) {
  if (type === 'review_invite') {
    await queueAndSendOrderNotification(sql, orderId, 'order_delivered', scheduledAt);
  }
  const notification = await queueOrderNotification(sql, orderId, type, scheduledAt);
  if (!notification) return { queued: false, sent: false };
  const terminal = terminalNotificationResult(notification);
  if (terminal) return { queued: true, ...terminal };
  if (new Date(notification.scheduled_at).getTime() > Date.now()) return { queued: true, sent: false };
  const result = await sendNotification(sql, notification);
  return { queued: true, ...result };
}

async function deliverPendingNotifications(sql, limit = 10) {
  const rows = await sql`
    SELECT * FROM notifications
    WHERE status IN ('pending','pending_configuration')
      AND scheduled_at<=NOW() AND attempts<5
    ORDER BY scheduled_at,id
    LIMIT ${Math.max(1, Math.min(25, Number(limit) || 10))}
  `;
  const results = [];
  for (const notification of rows) results.push(await sendNotification(sql, notification));
  return results;
}

async function ensureReviewInvites(sql, orderId) {
  const rows = await sql`
    SELECT customer_id,status,payment_status,payment_status_detail
    FROM orders WHERE id=${orderId} LIMIT 1
  `;
  if (!rows.length || !rows[0].customer_id || !notificationAllowed('review_invite', rows[0])) return [];
  const items = await sql`SELECT DISTINCT product_id FROM order_items WHERE order_id=${orderId}`;
  const created = [];
  for (const item of items) {
    const token = require('crypto').randomBytes(24).toString('hex');
    const result = await sql`
      INSERT INTO reviews(product_id,order_id,customer_id,review_token)
      VALUES(${item.product_id},${orderId},${rows[0].customer_id},${token})
      ON CONFLICT(order_id,product_id) DO UPDATE SET customer_id=EXCLUDED.customer_id
      RETURNING id,product_id,review_token
    `;
    if (result[0]) created.push(result[0]);
  }
  return created;
}

module.exports = {
  AUTO_TERMINAL_NOTIFICATION_STATUSES,
  emailEnabled,
  emailContent,
  notificationAllowed,
  queueOrderNotification,
  queueAndSendOrderNotification,
  deliverPendingNotifications,
  ensureReviewInvites,
  senderEmail,
  validEmail
};
