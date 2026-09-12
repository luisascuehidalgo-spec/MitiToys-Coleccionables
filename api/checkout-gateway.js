const { getDb } = require('../lib/db');
const checkoutHandler = require('./crear-preferencia-carrito');
const {
  CHECKOUT_LOCK_MINUTES,
  checkoutRateKey,
  consumeCheckoutAttempt
} = require('../lib/checkout-rate-limit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return checkoutHandler(req, res);

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

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
