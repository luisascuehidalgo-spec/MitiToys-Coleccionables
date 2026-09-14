const { getDb } = require('../lib/db');
const checkoutHandler = require('./crear-preferencia-carrito');
const {
  CHECKOUT_LOCK_MINUTES,
  checkoutRateKey,
  consumeCheckoutAttempt
} = require('../lib/checkout-rate-limit');

function isJsonRequest(req) {
  return String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase() === 'application/json';
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

function isAllowedCheckoutOrigin(req) {
  const headers = req?.headers || {};
  const fetchSite = String(headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin') return false;

  const rawOrigin = String(headers.origin || '').trim();
  if (!rawOrigin) return !fetchSite || fetchSite === 'same-origin';
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return checkoutHandler(req, res);

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!isAllowedCheckoutOrigin(req)) {
    return res.status(403).json({
      code: 'CHECKOUT_ORIGIN_NOT_ALLOWED',
      error: 'Origen de checkout no permitido.'
    });
  }
  if (!isJsonRequest(req)) {
    return res.status(415).json({
      code: 'CHECKOUT_JSON_REQUIRED',
      error: 'Formato de checkout no permitido.'
    });
  }

  try {
    const ipHash = checkoutRateKey(req, process.env.ADMIN_SESSION_SECRET);
    if (ipHash) {
      const limit = await consumeCheckoutAttempt(getDb(), ipHash);
      if (limit.blocked) {
        res.setHeader('Retry-After', String(CHECKOUT_LOCK_MINUTES * 60));
        return res.status(429).json({
          code: 'CHECKOUT_RATE_LIMITED',
          error: 'Hubo demasiados intentos de checkout. Esperá unos minutos y volvé a intentar.'
        });
      }
    }
  } catch (error) {
    console.warn('checkout rate limit unavailable:', 'code=' + String(error?.code || error?.name || 'CHECKOUT_RATE_LIMIT_UNAVAILABLE'));
  }

  return checkoutHandler(req, res);
};

module.exports.isJsonRequest = isJsonRequest;
module.exports.isAllowedCheckoutOrigin = isAllowedCheckoutOrigin;
