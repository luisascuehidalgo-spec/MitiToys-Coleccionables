// Mititoys admin authentication
const crypto = require('crypto');
const { getDb } = require('../lib/db');
const {
  adminLoginRateKey,
  adminLoginBlocked,
  recordAdminLoginFailure,
  clearAdminLoginFailures,
  ADMIN_LOGIN_LOCK_MINUTES
} = require('../lib/admin-rate-limit');

const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_SESSION_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ADMIN_SESSION_MAX_AGE_SECONDS = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
const ADMIN_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sign(value, secret = process.env.ADMIN_SESSION_SECRET) {
  const key = String(secret || '');
  if (!key) return '';
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSessionToken(secret, now = Date.now()) {
  const key = String(secret || '');
  const issuedAt = Number(now);
  if (!key || !Number.isInteger(issuedAt) || issuedAt < 0) return '';
  const value = `admin:${issuedAt}`;
  return Buffer.from(`${value}.${sign(value, key)}`).toString('base64url');
}

function verifySessionToken(token, secret, now = Date.now()) {
  const key = String(secret || '');
  const currentTime = Number(now);
  if (!key || !token || !Number.isFinite(currentTime)) return false;

  try {
    const decoded = Buffer.from(String(token), 'base64url').toString('utf8');
    const dot = decoded.lastIndexOf('.');
    if (dot < 1) return false;

    const value = decoded.slice(0, dot);
    const signature = decoded.slice(dot + 1);
    const match = value.match(/^admin:(\d{1,16})$/);
    if (!match || !/^[a-f0-9]{64}$/i.test(signature)) return false;

    const issuedAt = Number(match[1]);
    if (!Number.isInteger(issuedAt) || issuedAt < 0) return false;
    if (issuedAt > currentTime + ADMIN_SESSION_FUTURE_SKEW_MS) return false;
    if (currentTime - issuedAt > ADMIN_SESSION_TTL_MS) return false;

    const expected = sign(value, key);
    return safeEqual(signature, expected);
  } catch (_) {
    return false;
  }
}

function firstHeader(value) {
  return String(value ?? '').split(',')[0].trim();
}

function isLocalHost(host) {
  const normalized = String(host || '').toLowerCase();
  return normalized === 'localhost' || normalized.startsWith('localhost:')
    || normalized === '127.0.0.1' || normalized.startsWith('127.0.0.1:')
    || normalized === '[::1]' || normalized.startsWith('[::1]:');
}

function verifyMutationOrigin(req) {
  const method = String(req?.method || '').toUpperCase();
  if (!ADMIN_MUTATING_METHODS.has(method)) return true;

  const headers = req?.headers || {};
  const fetchSite = String(headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin') return false;

  const rawOrigin = String(headers.origin || '').trim();
  if (!rawOrigin) {
    // Modern browsers send Origin on same-origin mutating fetches. When neither
    // browser metadata header is present, preserve compatibility for non-browser
    // tooling while SameSite=Strict remains the baseline cookie protection.
    return !fetchSite || fetchSite === 'same-origin';
  }
  if (rawOrigin === 'null') return false;

  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch (_) {
    return false;
  }

  const host = firstHeader(headers.host).toLowerCase();
  if (!host || origin.host.toLowerCase() !== host) return false;

  const forwardedProto = firstHeader(headers['x-forwarded-proto']).toLowerCase();
  if (forwardedProto) return origin.protocol === `${forwardedProto}:`;
  if (isLocalHost(host)) return origin.protocol === 'http:' || origin.protocol === 'https:';
  return origin.protocol === 'https:';
}

function rateLimited(res) {
  res.setHeader('Retry-After', String(ADMIN_LOGIN_LOCK_MINUTES * 60));
  return res.status(429).json({ error: 'Demasiados intentos. Probá nuevamente más tarde.' });
}

module.exports = async (req, res) => {
  if (ADMIN_MUTATING_METHODS.has(String(req.method || '').toUpperCase()) && !verifyMutationOrigin(req)) {
    return res.status(403).json({ error: 'Origen de administración no permitido.' });
  }

  if (req.method === 'POST') {
    const configured = String(process.env.ADMIN_PASSWORD || '');
    const secret = String(process.env.ADMIN_SESSION_SECRET || '');
    if (!configured || !secret) {
      console.error('admin auth configuration error:', 'code=ADMIN_AUTH_NOT_CONFIGURED');
      return res.status(503).json({ error: 'Administración no disponible temporalmente.' });
    }

    const sql = getDb();
    const rateKey = adminLoginRateKey(req, secret);
    try {
      if (await adminLoginBlocked(sql, rateKey)) return rateLimited(res);
    } catch (error) {
      console.error('admin auth rate limit error:', 'code=' + String(error?.code || error?.name || 'ADMIN_RATE_LIMIT_ERROR'));
      return res.status(503).json({ error: 'Administración no disponible temporalmente.' });
    }

    const password = String(req.body?.password || '');
    if (!safeEqual(password, configured)) {
      try {
        const failure = await recordAdminLoginFailure(sql, rateKey);
        if (failure.locked) return rateLimited(res);
      } catch (error) {
        console.error('admin auth failure tracking error:', 'code=' + String(error?.code || error?.name || 'ADMIN_RATE_LIMIT_ERROR'));
        return res.status(503).json({ error: 'Administración no disponible temporalmente.' });
      }
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    try {
      await clearAdminLoginFailures(sql, rateKey);
    } catch (error) {
      console.error('admin auth rate reset error:', 'code=' + String(error?.code || error?.name || 'ADMIN_RATE_LIMIT_ERROR'));
      return res.status(503).json({ error: 'Administración no disponible temporalmente.' });
    }

    const token = createSessionToken(secret);
    if (!token) {
      console.error('admin auth session error:', 'code=ADMIN_SESSION_CREATE_FAILED');
      return res.status(503).json({ error: 'Administración no disponible temporalmente.' });
    }

    res.setHeader('Set-Cookie', `mititoys_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'mititoys_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
};

module.exports.verify = function verify(req) {
  if (!verifyMutationOrigin(req)) return false;
  const secret = String(process.env.ADMIN_SESSION_SECRET || '');
  if (!secret) return false;
  const header = String(req.headers?.cookie || '');
  const match = header.match(/(?:^|; )mititoys_admin=([^;]+)/);
  return Boolean(match && verifySessionToken(match[1], secret));
};

module.exports.createSessionToken = createSessionToken;
module.exports.verifySessionToken = verifySessionToken;
module.exports.verifyMutationOrigin = verifyMutationOrigin;
module.exports.safeEqual = safeEqual;
module.exports.ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_MS;
module.exports.ADMIN_SESSION_FUTURE_SKEW_MS = ADMIN_SESSION_FUTURE_SKEW_MS;
module.exports.ADMIN_SESSION_MAX_AGE_SECONDS = ADMIN_SESSION_MAX_AGE_SECONDS;
