const PRODUCTOS = {
  "3377": {
    id: "3377",
    title: "Figura Luffy Gear 5 – Nika – One Piece – 31 cm",
    description: "Figura coleccionable de Monkey D. Luffy Gear 5 / Nika, One Piece. 31 cm aprox., PVC, incluye figura + caja.",
    price: 150000,
    picture_url: "https://raw.githubusercontent.com/luisascuehidalgo-spec/imagenes/main/20241123034449_1.jpg"
  },
  "3375": {
    id: "3375",
    title: "Figura One Piece Kaido Dragón 30 Cm PVC Coleccionable Anime",
    description: "Estatua coleccionable de Kaido con dragón azul. 30 cm aprox. de altura, 37 cm aprox. de ancho, PVC.",
    price: 300000,
    picture_url: "https://raw.githubusercontent.com/luisascuehidalgo-spec/COD-3375/main/D_NQ_NP_2X_758000-MLA115602430906_092026-F.webp"
  }
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "Falta configurar MERCADOPAGO_ACCESS_TOKEN en Vercel." });
  }

  try {
    const { productId } = req.body || {};
    const product = PRODUCTOS[String(productId)];

    if (!product) {
      return res.status(400).json({ error: "Producto no válido." });
    }

    const origin = req.headers.origin || "https://otaku-collectibles.vercel.app";

    const preference = {
      items: [
        {
          id: product.id,
          title: product.title,
          description: product.description,
          picture_url: product.picture_url,
          quantity: 1,
          currency_id: "ARS",
          unit_price: product.price
        }
      ],
      external_reference: `MITITOYS-${product.id}`,
      back_urls: {
        success: `${origin}/?pago=exitoso`,
        pending: `${origin}/?pago=pendiente`,
        failure: `${origin}/?pago=fallido`
      },
      auto_return: "approved",
      statement_descriptor: "MITITOYS"
    };

    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(preference)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Mercado Pago error:", data);
      return res.status(response.status).json({ error: "Mercado Pago rechazó la creación del pago.", detail: data });
    }

    return res.status(200).json({ init_point: data.init_point, preference_id: data.id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "No se pudo crear el pago." });
  }
};
