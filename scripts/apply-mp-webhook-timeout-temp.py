from pathlib import Path

p = Path('api/webhook-mercadopago.js')
s = p.read_text()
anchor = "const { orderStatusFromPayment, isLateApprovalConflict } = require('../lib/order-state');\n"
if anchor not in s:
    raise SystemExit('order-state import not found')
s = s.replace(anchor, anchor + "const { getPayment } = require('../lib/payments');\n", 1)
old = """    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'Falta configurar MERCADOPAGO_ACCESS_TOKEN.' });

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const payment = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok) {
      console.error('Error consultando pago en Mercado Pago:', 'status=' + String(paymentResponse.status));
      return res.status(502).json({ error: 'No se pudo consultar el pago.' });
    }
"""
new = """    let payment;
    try {
      payment = await getPayment(dataId);
    } catch (error) {
      if (error?.code === 'MP_NOT_CONFIGURED') {
        return res.status(500).json({ error: 'Falta configurar MERCADOPAGO_ACCESS_TOKEN.' });
      }
      console.error(
        'Error consultando pago en Mercado Pago:',
        'code=' + String(error?.code || 'MP_PAYMENT_LOOKUP_FAILED'),
        'status=' + String(error?.providerStatus || 'unknown')
      );
      return res.status(502).json({ error: 'No se pudo consultar el pago.' });
    }
"""
if old not in s:
    raise SystemExit('payment fetch block not found')
p.write_text(s.replace(old, new, 1))
