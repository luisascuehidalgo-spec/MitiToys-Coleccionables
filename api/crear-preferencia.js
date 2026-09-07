module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(410).json({
    code: 'LEGACY_CHECKOUT_RETIRED',
    error: 'Este flujo de pago fue reemplazado. Continuá la compra desde el carrito para calcular el envío y pagar de forma segura.',
    cart_url: '/carrito.html',
    checkout_url: '/checkout.html?cart=1'
  });
};
