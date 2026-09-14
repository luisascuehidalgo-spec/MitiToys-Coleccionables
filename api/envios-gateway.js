const { getDb } = require('../lib/db');
const shippingHandler = require('./envios');
const {
  SHIPPING_QUOTE_LOCK_MINUTES,
  shippingQuoteRateKey,
  consumeShippingQuoteAttempt
} = require('../lib/shipping-quote-rate-limit');

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

function isAllowedShippingOrigin(req) {
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
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method !== 'POST') {
    if (req.method === 'GET') return shippingHandler(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  if (!isAllowedShippingOrigin(req)) {
    return res.status(403).json({
      code: 'SHIPPING_ORIGIN_NOT_ALLOWED',
      error: 'Origen de cotización no permitido.'
    });
  }
  if (!isJsonRequest(req)) {
    return res.status(415).json({
      code: 'SHIPPING_QUOTE_JSON_REQUIRED',
      error: 'Formato de cotización no permitido.'
    });
  }

  try {
    const ipHash = shippingQuoteRateKey(req, process.env.ADMIN_SESSION_SECRET);
    if (ipHash) {
      const limit = await consumeShippingQuoteAttempt(getDb(), ipHash);
      if (limit.blocked) {
        res.setHeader('Retry-After', String(SHIPPING_QUOTE_LOCK_MINUTES * 60));
        return res.status(429).json({
          code: 'SHIPPING_QUOTE_RATE_LIMITED',
          error: 'Hubo demasiadas cotizaciones de envío. Esperá unos minutos y volvé a intentar.'
        });
      }
    }
  } catch (error) {
    console.warn('shipping quote rate limit unavailable:', 'code=' + String(error?.code || error?.name || 'SHIPPING_QUOTE_RATE_LIMIT_UNAVAILABLE'));
  }

  return shippingHandler(req, res);
};

module.exports.isJsonRequest = isJsonRequest;
module.exports.isAllowedShippingOrigin = isAllowedShippingOrigin;
