const test = require('node:test');
const assert = require('node:assert/strict');

const { queueAndSendOrderNotification } = require('../lib/notifications');

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  };
}

function notificationSql({ failSentPersistence = false } = {}) {
  let status = 'pending';
  let providerId = null;
  const notification = () => ({
    id: 9,
    order_id: 77,
    type: 'payment_approved',
    recipient: 'cliente@example.com',
    status,
    provider_id: providerId,
    idempotency_key: 'payment_approved:77',
    scheduled_at: '2026-09-01T00:00:00.000Z'
  });

  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('FROM orders o LEFT JOIN customers')) {
      return [{
        id: 77,
        order_number: 'MT-77',
        customer_name: 'Cliente Test',
        customer_email: 'cliente@example.com'
      }];
    }
    if (text.includes('FROM order_items')) return [{ product_id: '3377', product_title: 'Figura Test', quantity: 1 }];
    if (text.includes('FROM reviews')) return [];
    if (text.includes('INSERT INTO notifications')) return [notification()];
    if (text.includes("UPDATE notifications SET status='sending'")) {
      if (!['pending','pending_configuration'].includes(status)) return [];
      status = 'sending';
      return [notification()];
    }
    if (text.includes('SELECT status,provider_id FROM notifications')) return [{ status, provider_id: providerId }];
    if (text.includes("UPDATE notifications SET status='sent'")) {
      if (failSentPersistence) throw new Error('simulated database write failure after provider success');
      status = 'sent';
      providerId = String(values[0] || '');
      return [{ provider_id: providerId }];
    }
    if (text.includes('UPDATE notifications SET status=?')) {
      const nextStatus = String(values[0]);
      if (status === 'sent') return [];
      status = nextStatus;
      return [{ status, provider_id: providerId }];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  return { sql, getStatus: () => status };
}

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

test('timeout ambiguo se reintenta inmediatamente con payload y llave idénticos', async t => {
  withEmailEnv(t);
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), body: options.body, key: options.headers['Idempotency-Key'] });
    if (calls.length === 1) {
      const error = new Error('socket timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    return response({ id: 'email-77' }, 200);
  };
  t.after(() => { global.fetch = previousFetch; });

  const state = notificationSql();
  const result = await queueAndSendOrderNotification(state.sql, 77, 'payment_approved');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].key, 'payment_approved:77');
  assert.equal(calls[1].key, calls[0].key);
  assert.equal(result.sent, true);
  assert.equal(result.id, 'email-77');
  assert.equal(state.getStatus(), 'sent');
});

test('dos resultados de transporte ambiguos quedan en delivery_uncertain y no se reenvían después', async t => {
  withEmailEnv(t);
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    const error = new Error('network unavailable');
    error.name = 'TimeoutError';
    throw error;
  };
  t.after(() => { global.fetch = previousFetch; });

  const state = notificationSql();
  const first = await queueAndSendOrderNotification(state.sql, 77, 'payment_approved');
  assert.equal(first.sent, false);
  assert.equal(first.reason, 'delivery_uncertain');
  assert.equal(state.getStatus(), 'delivery_uncertain');
  assert.equal(fetchCalls, 2);

  const second = await queueAndSendOrderNotification(state.sql, 77, 'payment_approved');
  assert.equal(second.sent, false);
  assert.equal(second.reason, 'delivery_uncertain');
  assert.equal(fetchCalls, 2, 'No debe volver a contactar a Resend después de un resultado ambiguo terminal.');
});

test('si Resend responde OK pero falla persistir sent, el claim sending impide un segundo correo', async t => {
  withEmailEnv(t);
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return response({ id: 'email-accepted' }, 200);
  };
  t.after(() => { global.fetch = previousFetch; });

  const state = notificationSql({ failSentPersistence: true });
  await assert.rejects(
    () => queueAndSendOrderNotification(state.sql, 77, 'payment_approved'),
    /simulated database write failure/
  );
  assert.equal(fetchCalls, 1);
  assert.equal(state.getStatus(), 'sending');

  const retry = await queueAndSendOrderNotification(state.sql, 77, 'payment_approved');
  assert.equal(retry.sent, false);
  assert.equal(retry.reason, 'in_flight');
  assert.equal(fetchCalls, 1, 'Un fallo local posterior al OK del proveedor no puede reenviar el email.');
});

test('rechazo explícito de Resend queda failed y tampoco entra en reintentos automáticos tardíos', async t => {
  withEmailEnv(t);
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return response({ name: 'validation_error' }, 400);
  };
  t.after(() => { global.fetch = previousFetch; });

  const state = notificationSql();
  const first = await queueAndSendOrderNotification(state.sql, 77, 'payment_approved');
  assert.equal(first.sent, false);
  assert.equal(first.reason, 'failed');
  assert.equal(state.getStatus(), 'failed');
  assert.equal(fetchCalls, 1);

  const second = await queueAndSendOrderNotification(state.sql, 77, 'payment_approved');
  assert.equal(second.reason, 'failed');
  assert.equal(fetchCalls, 1);
});
