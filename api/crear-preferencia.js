module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  return res.status(410).json({
    code: 'LEGACY_CHECKOUT_DISABLED',
    error: 'Este checkout fue reemplazado. Continuá desde el carrito para calcular el envío y pagar de forma segura.',
    checkout_url: '/checkout.html?cart=1'
  });
};
