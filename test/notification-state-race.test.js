const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureReviewInvites, queueAndSendOrderNotification, queueOrderNotification } = require('../lib/notifications');

function withEmailEnv(t) {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.MITITOYS_FROM_EMAIL;
  process.env.RESEND_API_KEY = 'test-key';
  process.env.MITITOYS_FROM_EMAIL = 'MitiToys <pedidos@mititoys.com>';
  t.after(() => {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.MITITOYS_FROM_EMAIL; else process.env.MITITOYS_FROM_EMAIL = oldFrom;
  });
}

test('una aprobación encolada se descarta si el pedido fue reembolsado antes de enviar', async t => {
  withEmailEnv(t);
  const oldFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Resend no debe ser llamado para una notificación obsoleta');
  };
  t.after(() => { global.fetch = oldFetch; });

  let contextReads = 0;
  let notificationStatus = 'pending';
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('FROM orders o LEFT JOIN customers')) {
      contextReads += 1;
      if (contextReads === 1) {
        return [{
          id: 77,
          order_number: 'MT-77',
          status: 'approved',
          payment_status: 'approved',
          payment_status_detail: null,
          customer_name: 'Cliente Test',
          customer_email: 'cliente@example.com'
        }];
      }
      return [{
        id: 77,
        order_number: 'MT-77',
        status: 'refunded',
        payment_status: 'refunded',
        payment_status_detail: 'refunded',
        customer_name: 'Cliente Test',
        customer_email: 'cliente@example.com'
      }];
    }
    if (text.includes('FROM order_items')) return [];
    if (text.includes('FROM reviews')) return [];
    if (text.includes('INSERT INTO notifications')) {
      return [{
        id: 9,
        order_id: 77,
        type: 'payment_approved',
        recipient: 'cliente@example.com',
        status: notificationStatus,
        provider_id: null,
        idempotency_key: 'payment_approved:77',
        scheduled_at: '2026-09-01T00:00:00.000Z'
      }];
    }
    if (text.includes("UPDATE notifications SET status='sending'")) {
      notificationStatus = 'sending';
      return [{
        id: 9,
        order_id: 77,
        type: 'payment_approved',
        recipient: 'cliente@example.com',
        status: notificationStatus,
        provider_id: null,
        idempotency_key: 'payment_approved:77',
        scheduled_at: '2026-09-01T00:00:00.000Z'
      }];
    }
    if (text.includes("UPDATE notifications SET status='superseded'")) {
      notificationStatus = 'superseded';
      return [{ status: notificationStatus, provider_id: null }];
    }
    throw new Error('SQL inesperado: ' + text + ' values=' + JSON.stringify(values));
  };

  const result = await queueAndSendOrderNotification(sql, 77, 'payment_approved');
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'superseded');
  assert.equal(notificationStatus, 'superseded');
  assert.equal(fetchCalls, 0);
});

test('review_invite encola primero order_delivered para recuperar una entrega omitida', async () => {
  const insertedTypes = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('FROM orders o LEFT JOIN customers')) {
      return [{
        id: 88,
        order_number: 'MT-88',
        status: 'delivered',
        payment_status: 'approved',
        payment_status_detail: null,
        customer_name: 'Cliente Test',
        customer_email: 'cliente@example.com'
      }];
    }
    if (text.includes('FROM order_items')) return [{ product_id: '3377', product_title: 'Figura Test', quantity: 1 }];
    if (text.includes('FROM reviews')) return [{ product_id: '3377', review_token: 'token-test' }];
    if (text.includes('INSERT INTO notifications')) {
      const type = String(values[1]);
      insertedTypes.push(type);
      return [{
        id: insertedTypes.length,
        order_id: 88,
        type,
        recipient: 'cliente@example.com',
        status: 'pending',
        provider_id: null,
        idempotency_key: `${type}:88`,
        scheduled_at: '2026-09-01T00:00:00.000Z'
      }];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const result = await queueOrderNotification(sql, 88, 'review_invite');
  assert.equal(result.type, 'review_invite');
  assert.deepEqual(insertedTypes, ['order_delivered', 'review_invite']);
});

test('review_invite no se encola si el pedido entregado fue reembolsado', async () => {
  let insertCalls = 0;
  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('FROM orders o LEFT JOIN customers')) {
      return [{
        id: 99,
        order_number: 'MT-99',
        status: 'delivered',
        payment_status: 'refunded',
        payment_status_detail: null,
        customer_name: 'Cliente Test',
        customer_email: 'cliente@example.com'
      }];
    }
    if (text.includes('FROM order_items')) return [];
    if (text.includes('FROM reviews')) return [];
    if (text.includes('INSERT INTO notifications')) {
      insertCalls += 1;
      return [];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const result = await queueOrderNotification(sql, 99, 'review_invite');
  assert.equal(result, null);
  assert.equal(insertCalls, 0);
});

test('ensureReviewInvites no crea tokens si el pedido entregado ya no es financieramente elegible', async () => {
  let itemReads = 0;
  let reviewWrites = 0;
  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('SELECT customer_id,status,payment_status,payment_status_detail')) {
      return [{
        customer_id: 5,
        status: 'delivered',
        payment_status: 'refunded',
        payment_status_detail: null
      }];
    }
    if (text.includes('SELECT DISTINCT product_id')) {
      itemReads += 1;
      return [{ product_id: '3377' }];
    }
    if (text.includes('INSERT INTO reviews')) {
      reviewWrites += 1;
      return [];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const created = await ensureReviewInvites(sql, 100);
  assert.deepEqual(created, []);
  assert.equal(itemReads, 0);
  assert.equal(reviewWrites, 0);
});
