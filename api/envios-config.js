const { shippingEnabled } = require('../lib/shipping');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json({
    enabled: shippingEnabled(),
    provider: shippingEnabled() ? 'Envíopack' : null,
    mode: 'home_delivery'
  });
};
