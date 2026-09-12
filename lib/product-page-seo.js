function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function plainDescription(value, fallback) {
  return String(value || fallback || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 155);
}

function productSeoData(product) {
  const title = String(product?.title || `Producto ${product?.id || ''}`).trim();
  const description = plainDescription(product?.description, title);
  const canonical = `https://mititoys.com/producto.html?id=${encodeURIComponent(product?.id || '')}`;
  const images = Array.isArray(product?.images) ? product.images.filter(Boolean) : [];
  const image = images[0] || '';
  const available = !product?.stock_managed || Number(product?.stock_quantity || 0) > 0;
  return { title, description, canonical, images, image, available };
}

function renderProductSeo(template, product) {
  const seo = productSeoData(product);
  const h = escapeHtml;
  const schema = {
    '@context': 'https://schema.org', '@type': 'Product', name: seo.title,
    description: seo.description, image: seo.images, sku: String(product.id),
    brand: { '@type': 'Brand', name: 'Mititoys' },
    offers: { '@type': 'Offer', url: seo.canonical, priceCurrency: 'ARS', price: Number(product.price || 0), availability: seo.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' }
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: 'https://mititoys.com/' },
      { '@type': 'ListItem', position: 2, name: 'Figuras', item: 'https://mititoys.com/#catalogo' },
      { '@type': 'ListItem', position: 3, name: seo.title, item: seo.canonical }
    ]
  };
  if (Number(product.reviews_count || 0) > 0 && Number(product.rating || 0) > 0) {
    schema.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(product.rating), reviewCount: Number(product.reviews_count) };
  }
  const replacements = [
    ['<title>Producto | Mititoys coleccionables</title>', `<title>${h(seo.title)} | Mititoys</title>`],
    ['<meta name="description" content="Figura coleccionable de anime en Mititoys coleccionables.">', `<meta name="description" content="${h(seo.description)}">`],
    ['<link id="productCanonical" rel="canonical" href="https://mititoys.com/producto.html">', `<link id="productCanonical" rel="canonical" href="${h(seo.canonical)}">`],
    ['<meta property="og:title" content="Producto | Mititoys coleccionables">', `<meta property="og:title" content="${h(seo.title)}">`],
    ['<meta property="og:description" content="Figura coleccionable de anime en Mititoys coleccionables.">', `<meta property="og:description" content="${h(seo.description)}">`],
    ['<meta property="og:url" content="https://mititoys.com/producto.html">', `<meta property="og:url" content="${h(seo.canonical)}">`],
    ['<meta name="twitter:title" content="Producto | Mititoys coleccionables">', `<meta name="twitter:title" content="${h(seo.title)}">`],
    ['<meta name="twitter:description" content="Figura coleccionable de anime en Mititoys coleccionables.">', `<meta name="twitter:description" content="${h(seo.description)}">`]
  ];
  let html = template;
  for (const [from, to] of replacements) html = html.replace(from, to);
  if (seo.image) {
    html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${h(seo.image)}">`);
    html = html.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${h(seo.image)}">`);
  }
  html = html.replace(/<script id="productSchema" type="application\/ld\+json">[^<]*<\/script>/, `<script id="productSchema" type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`);
  html = html.replace('</head>', `<script id="breadcrumbSchema" type="application/ld+json">${JSON.stringify(breadcrumbSchema).replace(/</g, '\\u003c')}</script>\n</head>`);
  return html;
}

module.exports = { escapeHtml, plainDescription, productSeoData, renderProductSeo };
