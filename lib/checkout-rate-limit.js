const crypto = require('crypto');
const { clientIp } = require('./admin-rate-limit');

const CHECKOUT_MAX_ATTEMPTS = 12;
const CHECKOUT_WINDOW_MINUTES = 10;
const CHECKOUT_LOCK_MINUTES = 10;

function checkoutRateKey(req, secret) {
  const key = String(secret || '');
  if (!key) return '';
  return crypto.createHmac('sha256', key)
    .update(`checkout:${clientIp(req)}`)
    .digest('hex');
}

async function consumeCheckoutAttempt(sql, ipHash) {
  if (!ipHash) return { blocked: false, attempts: 0 };

  const rows = await sql`
    INSERT INTO admin_login_attempts(ip_hash,failures,window_started_at,locked_until,updated_at)
    VALUES(${ipHash},1,NOW(),NULL,NOW())
    ON CONFLICT(ip_hash) DO UPDATE SET
      failures=CASE
        WHEN admin_login_attempts.window_started_at < NOW()-INTERVAL '10 minutes' THEN 1
        ELSE admin_login_attempts.failures+1
      END,
      window_started_at=CASE
        WHEN admin_login_attempts.window_started_at < NOW()-INTERVAL '10 minutes' THEN NOW()
        ELSE admin_login_attempts.window_started_at
      END,
      locked_until=CASE
        WHEN admin_login_attempts.locked_until IS NOT NULL AND admin_login_attempts.locked_until > NOW() THEN admin_login_attempts.locked_until
        WHEN admin_login_attempts.window_started_at < NOW()-INTERVAL '10 minutes' THEN NULL
        WHEN admin_login_attempts.failures+1 > ${CHECKOUT_MAX_ATTEMPTS} THEN NOW()+INTERVAL '10 minutes'
        ELSE NULL
      END,
      updated_at=NOW()
    RETURNING failures,
      locked_until IS NOT NULL AND locked_until > NOW() AS blocked
  `;

  return {
    attempts: Number(rows[0]?.failures || 0),
    blocked: Boolean(rows[0]?.blocked)
  };
}

module.exports = {
  CHECKOUT_MAX_ATTEMPTS,
  CHECKOUT_WINDOW_MINUTES,
  CHECKOUT_LOCK_MINUTES,
  checkoutRateKey,
  consumeCheckoutAttempt
};
