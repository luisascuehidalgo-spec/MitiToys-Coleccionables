const SITE_URL = String(process.env.PUBLIC_SITE_URL || 'https://otaku-collectibles.vercel.app').replace(/\/$/, '');

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
      const url = `${SITE_URL}/opinar.html?token=${encodeURIComponent(review.review_token)}`;
      return `<p><a href="${escapeHtml(url)}" style="color:#ffd21c;font-weight:800">Opinar sobre ${escapeHtml(item?.product_title || 'tu figura ' + (index + 1))}</a></p>`;
    }).join('');
    return shell('¿Cómo fue tu compra?', 'tu opinión ayuda a otros coleccionistas. El enlace está habilitado únicamente para productos que compraste.', links, 'VER MI PEDIDO', trackUrl);
  }
  return null;
}

async function queueOrderNotification(sql, orderId, type, scheduledAt = new Date()) {
  const context = await orderContext(sql, orderId);
  if (!context) return null;
  const key = `${type}:${orderId}`;
  const rows = await sql`
    INSERT INTO notifications(order_id,type,recipient,idempotency_key,scheduled_at)
    VALUES(${orderId},${type},${context.order.customer_email},${key},${scheduledAt.toISOString()})
    ON CONFLICT(idempotency_key) DO UPDATE SET recipient=EXCLUDED.recipient
    RETURNING *
  `;
  return rows[0] || null;
}

async function sendNotification(sql, notification) {
  if (!notification) return { sent: false, reason: 'missing' };
  if (!emailEnabled()) {
    await sql`UPDATE notifications SET status='pending_configuration',updated_at=NOW() WHERE id=${notification.id}`;
    return { sent: false, reason: 'not_configured' };
  }
  const context = await orderContext(sql, notification.order_id);
  const content = context && emailContent(notification.type, context);
  if (!content) {
    await sql`UPDATE notifications SET status='failed',last_error='Plantilla o pedido no disponible',attempts=attempts+1,updated_at=NOW() WHERE id=${notification.id}`;
    return { sent: false, reason: 'invalid_context' };
  }
  const replyTo = validEmail(process.env.MITITOYS_REPLY_TO_EMAIL) || senderEmail();
  const copyTo = validEmail(process.env.MITITOYS_EMAIL_COPY) || replyTo;
  const payload = {
    from: process.env.MITITOYS_FROM_EMAIL,
    to: [notification.recipient],
    subject: content.subject,
    html: content.html
  };
  if (replyTo) payload.reply_to = replyTo;
  if (copyTo && copyTo !== validEmail(notification.recipient)) payload.bcc = [copyTo];

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': notification.idempotency_key
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.message || data?.error || 'Error del proveedor').slice(0, 500);
    await sql`UPDATE notifications SET status='failed',last_error=${message},attempts=attempts+1,updated_at=NOW() WHERE id=${notification.id}`;
    return { sent: false, reason: message };
  }
  await sql`UPDATE notifications SET status='sent',provider_id=${String(data.id || '')},last_error=NULL,attempts=attempts+1,sent_at=NOW(),updated_at=NOW() WHERE id=${notification.id}`;
  return { sent: true, id: data.id || null };
}

async function queueAndSendOrderNotification(sql, orderId, type, scheduledAt) {
  const notification = await queueOrderNotification(sql, orderId, type, scheduledAt);
  if (!notification || new Date(notification.scheduled_at).getTime() > Date.now()) return { queued: Boolean(notification), sent: false };
  const result = await sendNotification(sql, notification);
  return { queued: true, ...result };
}

async function deliverPendingNotifications(sql, limit = 10) {
  const rows = await sql`
    SELECT * FROM notifications
    WHERE status IN ('pending','pending_configuration','failed')
      AND scheduled_at<=NOW() AND attempts<5
    ORDER BY scheduled_at,id
    LIMIT ${Math.max(1, Math.min(25, Number(limit) || 10))}
  `;
  const results = [];
  for (const notification of rows) results.push(await sendNotification(sql, notification));
  return results;
}

async function ensureReviewInvites(sql, orderId) {
  const rows = await sql`SELECT customer_id FROM orders WHERE id=${orderId} LIMIT 1`;
  if (!rows.length) return [];
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
  emailEnabled,
  emailContent,
  queueOrderNotification,
  queueAndSendOrderNotification,
  deliverPendingNotifications,
  ensureReviewInvites,
  senderEmail,
  validEmail
};
