const crypto = require('crypto');
const { clientIp } = require('./admin-rate-limit');

const ORDER_STATUS_MAX_FAILURES = 20;
const ORDER_STATUS_WINDOW_MINUTES = 15;
const ORDER_STATUS_LOCK_MINUTES = 15;

function orderStatusRateKey(req, secret) {
  const key = String(secret || '');
  if (!key) return '';
  return crypto.createHmac('sha256', key)
    .update(`order-status:${clientIp(req)}`)
    .digest('hex');
}

async function orderStatusBlocked(sql, ipHash) {
  if (!ipHash) return false;
  const rows = await sql`
    SELECT locked_until IS NOT NULL AND locked_until > NOW() AS blocked
    FROM admin_login_attempts
    WHERE ip_hash=${ipHash}
    LIMIT 1
  `;
  return Boolean(rows[0]?.blocked);
}

async function recordOrderStatusFailure(sql, ipHash) {
  if (!ipHash) return { failures: 0, locked: false };
  const rows = await sql`
    INSERT INTO admin_login_attempts(ip_hash,failures,window_started_at,locked_until,updated_at)
    VALUES(${ipHash},1,NOW(),NULL,NOW())
    ON CONFLICT(ip_hash) DO UPDATE SET
      failures=CASE
        WHEN admin_login_attempts.window_started_at < NOW()-INTERVAL '15 minutes' THEN 1
        ELSE admin_login_attempts.failures+1
      END,
      window_started_at=CASE
        WHEN admin_login_attempts.window_started_at < NOW()-INTERVAL '15 minutes' THEN NOW()
        ELSE admin_login_attempts.window_started_at
      END,
      locked_until=CASE
        WHEN admin_login_attempts.window_started_at < NOW()-INTERVAL '15 minutes' THEN NULL
        WHEN admin_login_attempts.failures+1 >= ${ORDER_STATUS_MAX_FAILURES} THEN NOW()+INTERVAL '15 minutes'
        ELSE admin_login_attempts.locked_until
      END,
      updated_at=NOW()
    RETURNING failures,locked_until IS NOT NULL AND locked_until > NOW() AS locked
  `;
  return {
    failures: Number(rows[0]?.failures || 0),
    locked: Boolean(rows[0]?.locked)
  };
}

module.exports = {
  ORDER_STATUS_MAX_FAILURES,
  ORDER_STATUS_WINDOW_MINUTES,
  ORDER_STATUS_LOCK_MINUTES,
  orderStatusRateKey,
  orderStatusBlocked,
  recordOrderStatusFailure
};
