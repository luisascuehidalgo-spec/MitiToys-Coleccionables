module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(410).json({
    code: 'LEGACY_CHECKOUT_DISABLED',
    error: 'Este checkout fue reemplazado. Continuá desde el carrito para calcular el envío y pagar de forma segura.',
    checkout_url: '/checkout.html?cart=1'
  });
};
