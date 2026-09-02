const crypto = require("crypto");

function parseSignatureHeader(value) {
  const parts = {};
  for (const part of String(value || "").split(",")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length) parts[key.trim()] = rest.join("=").trim();
  }
  return parts;
}

function isValidSignature(req, dataId) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return false;

  const xSignature = req.headers["x-signature"] || "";
  const xRequestId = req.headers["x-request-id"] || "";
  const { ts, v1 } = parseSignatureHeader(xSignature);
  if (!ts || !v1) return false;

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch (_) {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const dataId = body?.data?.id || req.query?.["data.id"] || req.query?.id;
    const type = body?.type || req.query?.type;

    if (type !== "payment" && body?.action !== "payment.created" && body?.action !== "payment.updated") {
      return res.status(200).json({ received: true, ignored: true });
    }

    if (!dataId) {
      return res.status(400).json({ error: "Falta data.id" });
    }

    if (!isValidSignature(req, dataId)) {
      return res.status(401).json({ error: "Firma de Webhook inválida o clave no configurada." });
    }

    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) {
      console.error("Falta MERCADOPAGO_ACCESS_TOKEN");
      return res.status(500).json({ error: "Falta configurar MERCADOPAGO_ACCESS_TOKEN." });
    }

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      console.error("Error consultando pago en Mercado Pago:", payment);
      return res.status(502).json({ error: "No se pudo consultar el pago." });
    }

    console.log("Mercado Pago payment update", {
      id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail,
      external_reference: payment.external_reference,
      transaction_amount: payment.transaction_amount
    });

    return res.status(200).json({
      received: true,
      payment_id: payment.id,
      status: payment.status
    });
  } catch (error) {
    console.error("Webhook Mercado Pago error:", error);
    return res.status(500).json({ error: "Error procesando el Webhook." });
  }
};
