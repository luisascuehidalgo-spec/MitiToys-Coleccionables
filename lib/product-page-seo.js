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

module.exports = { escapeHtml, plainDescription, productSeoData };
