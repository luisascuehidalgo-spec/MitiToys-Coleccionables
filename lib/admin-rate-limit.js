const crypto = require('crypto');

const ADMIN_LOGIN_MAX_FAILURES = 6;
const ADMIN_LOGIN_WINDOW_MINUTES = 15;
const ADMIN_LOGIN_LOCK_MINUTES = 15;

function firstHeader(value) {
  return String(value ?? '').split(',')[0].trim();
}

function clientIp(req) {
  const headers = req?.headers || {};
  const forwarded = firstHeader(headers['x-forwarded-for']);
  const real = firstHeader(headers['x-real-ip']);
  return String(forwarded || real || 'unknown').slice(0, 128);
}

function adminLoginRateKey(req, secret) {
  const key = String(secret || '');
  if (!key) return '';
  return crypto.createHmac('sha256', key)
    .update(`admin-login:${clientIp(req)}`)
    .digest('hex');
}

async function adminLoginBlocked(sql, ipHash) {
  const rows = await sql`
    SELECT locked_until IS NOT NULL AND locked_until > NOW() AS blocked
    FROM admin_login_attempts
    WHERE ip_hash=${ipHash}
    LIMIT 1
  `;
  return Boolean(rows[0]?.blocked);
}

async function recordAdminLoginFailure(sql, ipHash) {
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
        WHEN admin_login_attempts.failures+1 >= ${ADMIN_LOGIN_MAX_FAILURES} THEN NOW()+INTERVAL '15 minutes'
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

async function clearAdminLoginFailures(sql, ipHash) {
  await sql`DELETE FROM admin_login_attempts WHERE ip_hash=${ipHash}`;
}

module.exports = {
  ADMIN_LOGIN_MAX_FAILURES,
  ADMIN_LOGIN_WINDOW_MINUTES,
  ADMIN_LOGIN_LOCK_MINUTES,
  clientIp,
  adminLoginRateKey,
  adminLoginBlocked,
  recordAdminLoginFailure,
  clearAdminLoginFailures
};
