const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { queueAndSendOrderNotification } = require('../lib/notifications');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('una notificación ya enviada nunca vuelve a llamar a Resend', async t => {
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Resend no debería ser llamado para una notificación sent');
  };
  t.after(() => { global.fetch = previousFetch; });

  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('FROM orders o LEFT JOIN customers')) {
      return [{
        id: 77,
        order_number: 'MT-77',
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
        type: 'review_invite',
        recipient: 'cliente@example.com',
        status: 'sent',
        provider_id: 'email-existing-1',
        idempotency_key: 'review_invite:77',
        scheduled_at: '2026-09-01T00:00:00.000Z'
      }];
    }
    throw new Error('SQL inesperado: ' + text);
  };

  const result = await queueAndSendOrderNotification(sql, 77, 'review_invite');
  assert.deepEqual(result, {
    queued: true,
    sent: false,
    reason: 'already_sent',
    id: 'email-existing-1'
  });
  assert.equal(fetchCalls, 0);
});

test('sent, sending, delivery_uncertain y failed son terminales para reenvío automático', () => {
  const notifications = read('lib/notifications.js');
  assert.match(notifications, /AUTO_TERMINAL_NOTIFICATION_STATUSES = new Set\(\['sent', 'sending', 'delivery_uncertain', 'failed'\]\)/);
  assert.match(notifications, /AUTO_TERMINAL_NOTIFICATION_STATUSES\.has\(status\)/);
  assert.match(notifications, /reason: 'already_sent'/);
  assert.match(notifications, /reason: 'in_flight'/);
  assert.match(notifications, /WHERE status IN \('pending','pending_configuration'\)/);
  assert.doesNotMatch(notifications, /WHERE status IN \('pending','pending_configuration','failed'\)/);
});
