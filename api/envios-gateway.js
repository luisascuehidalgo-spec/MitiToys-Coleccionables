const { getDb } = require('../lib/db');
const shippingHandler = require('./envios');
const {
  SHIPPING_QUOTE_LOCK_MINUTES,
  shippingQuoteRateKey,
  consumeShippingQuoteAttempt
} = require('../lib/shipping-quote-rate-limit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return shippingHandler(req, res);

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

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
