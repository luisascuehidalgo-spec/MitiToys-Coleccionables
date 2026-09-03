(() => {
  const CACHE_KEY = 'mititoys_catalog_cache_v2';
  const CACHE_TTL = 15 * 60 * 1000;
  const FALLBACK_3431 = {
    id: '3431',
    title: 'Figura Luffy Gear 5 – Nika – One Piece – 23 cm',
    description: 'Figura coleccionable de Luffy Gear 5 / Nika de One Piece, 23 cm. Ideal para colección y exhibición.',
    price: 120000,
    stock_quantity: 5,
    stock_managed: true,
    active: true,
    created_at: '2026-09-03T11:31:51.645Z',
    images: ['/api/product-image?id=4', '/api/product-image?id=5']
  };

  const money = value => new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const logo = 'https://raw.githubusercontent.com/luisascuehidalgo-spec/imagenes/main/WhatsApp%20Image%202026-09-01%20at%208.31.48%20PM.jpeg';

  function shortDescription(value) {
    const clean = String(value || 'Figura coleccionable de anime.')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (clean.length <= 190) return clean;
    const cut = clean.slice(0, 190);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 150))}…`;
  }

  function readCache() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!value || !Array.isArray(value.products) || Date.now() - Number(value.savedAt || 0) > CACHE_TTL) return [];
      return value.products;
    } catch (_) {
      return [];
    }
  }

  function saveCache(products) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), products }));
    } catch (_) {
      // The catalog still works when browser storage is unavailable.
    }
  }

  function enhanceStoreTrust() {
    const nav = document.querySelector('.links');
    if (nav && !nav.querySelector('[data-track-link]')) {
      const link = document.createElement('a');
      link.href = '/seguimiento.html';
      link.dataset.trackLink = '1';
      link.textContent = 'Seguir pedido';
      nav.appendChild(link);
    }

    if (!document.getElementById('mititoysTrustStyle')) {
      const style = document.createElement('style');
      style.id = 'mititoysTrustStyle';
      style.textContent = '.mt-support{max-width:1200px;margin:0 auto 55px;padding:0 22px}.mt-supportbox{background:linear-gradient(135deg,#111,#17100b);border:1px solid #30271d;border-radius:18px;padding:28px}.mt-supportbox h2{margin:0 0 8px;font-size:28px;color:#ffd21c}.mt-supportbox>p{margin:0 0 20px;color:#aaa}.mt-supportgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.mt-supportcard{display:block;background:#171717;border:1px solid #2a2a2a;border-radius:12px;padding:18px;transition:.2s}.mt-supportcard:hover{transform:translateY(-2px);border-color:#555}.mt-supportcard b{display:block;margin-bottom:7px;font-size:16px}.mt-supportcard span{color:#aaa;font-size:13px;line-height:1.5}.mt-footerlinks{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;margin-top:12px}.mt-footerlinks a{color:#bbb;font-size:13px}@media(max-width:760px){.mt-supportgrid{grid-template-columns:1fr}}';
      document.head.appendChild(style);
    }

    const footer = document.querySelector('footer');
    if (footer && !document.getElementById('mititoysSupport')) {
      const section = document.createElement('section');
      section.className = 'mt-support';
      section.id = 'mititoysSupport';
      section.innerHTML = '<div class="mt-supportbox"><h2>Comprá con tranquilidad</h2><p>Te acompañamos antes, durante y después de tu compra.</p><div class="mt-supportgrid"><a class="mt-supportcard" href="/seguimiento.html"><b>📦 Seguí tu pedido</b><span>Consultá de forma segura el estado del pago y del envío.</span></a><a class="mt-supportcard" href="/preguntas.html"><b>❓ Preguntas frecuentes</b><span>Encontrá respuestas rápidas sobre compras, pagos y entregas.</span></a><a class="mt-supportcard" href="/politicas.html"><b>🛡️ Políticas de compra</b><span>Información clara para comprar con mayor confianza.</span></a></div></div>';
      footer.parentNode.insertBefore(section, footer);
      footer.innerHTML = '© 2026 Mititoys coleccionables · Figuras de anime para coleccionistas<div class="mt-footerlinks"><a href="/seguimiento.html">Seguimiento</a><a href="/preguntas.html">Preguntas frecuentes</a><a href="/politicas.html">Políticas</a><a target="_blank" rel="noopener" href="https://wa.me/541133466187">WhatsApp</a></div>';
    }
  }

  function prepareExistingCards(grid) {
    grid.classList.add('catalog-ready');
    grid.querySelectorAll('.card').forEach((card, index) => {
      card.classList.add('catalog-card');
      const badge = card.querySelector('.badge');
      const title = card.querySelector('h3')?.textContent || '';
      const description = card.querySelector('.desc')?.textContent || '';
      const id = badge?.textContent.replace(/^COD\s*/i, '').trim() || '';
      const priceText = card.querySelector('.price')?.textContent || '';
      card.dataset.productId = id;
      card.dataset.search = normalize(`${id} ${title} ${description}`);
      card.dataset.sortName = normalize(title);
      card.dataset.price = String(Number(priceText.replace(/\D/g, '')) || 0);
      card.dataset.created = '0';
      card.dataset.originalOrder = String(index);
      card.querySelectorAll('img').forEach(image => {
        image.loading = 'lazy';
        image.decoding = 'async';
      });
    });
  }

  function renderProduct(grid, product, index) {
    if (!product || product.active === false) return;
    const images = Array.isArray(product.images) ? product.images.filter(Boolean).slice(0, 4) : [];
    if (!images.length) return;

    const stockManaged = Boolean(product.stock_managed);
    const stockQuantity = Math.max(0, Number(product.stock_quantity || 0));
    const available = !stockManaged || stockQuantity > 0;
    const stockText = available
      ? (stockManaged ? `${stockQuantity} ${stockQuantity === 1 ? 'unidad' : 'unidades'}` : 'Disponible')
      : 'Sin stock';
    const title = String(product.title || `Producto COD ${product.id}`);
    const description = shortDescription(product.description);
    const thumbs = images.map((url, imageIndex) => `<div class="thumbwrap ${imageIndex === 0 ? 'active' : ''}" data-index="${imageIndex}"><img class="thumb" src="${esc(url)}" alt="${esc(title)} foto ${imageIndex + 1}" loading="lazy" decoding="async"><img class="thumbwm" src="${logo}" alt="" loading="lazy" decoding="async"></div>`).join('');

    const card = document.createElement('article');
    card.className = 'card catalog-card dynamic-product';
    card.dataset.productId = String(product.id);
    card.dataset.search = normalize(`${product.id} ${title} ${description}`);
    card.dataset.sortName = normalize(title);
    card.dataset.price = String(Number(product.price || 0));
    card.dataset.created = String(Date.parse(product.created_at || '') || 0);
    card.dataset.originalOrder = String(index);
    card.innerHTML = `<div class="gallery"><div class="main-photo"><span class="badge">COD ${esc(product.id)}</span><span class="stock-chip ${available ? '' : 'out'}">${esc(stockText)}</span><img class="mainimg" src="${esc(images[0])}" alt="${esc(title)}" loading="lazy" decoding="async"><img class="watermark" src="${logo}" alt="Logo Mititoys coleccionables" loading="lazy" decoding="async"></div><div class="thumbs">${thumbs}</div></div><div class="body"><h3>${esc(title)}</h3><p class="desc">${esc(description)}</p><div class="specs"><span>📦 ${esc(stockText)}</span></div><div class="price">${money(product.price)} ARS</div><div class="card-actions"><a class="catalog-detail" href="/producto.html?id=${encodeURIComponent(product.id)}">VER PRODUCTO</a><button class="paybtn cart-add" type="button" ${available ? '' : 'disabled'}>${available ? '🛒 AGREGAR AL CARRITO' : 'SIN STOCK'}</button><button class="paybtn pay-now" type="button" ${available ? '' : 'disabled'}>COMPRAR AHORA</button></div><a class="catalog-whatsapp" target="_blank" rel="noopener" href="https://wa.me/541133466187?text=${encodeURIComponent(`Hola, quiero consultar por la figura ${title} COD ${product.id}`)}">Consultar por WhatsApp</a></div>`;

    card.querySelectorAll('.thumbwrap').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const main = card.querySelector('.mainimg');
        const image = thumb.querySelector('.thumb');
        if (main && image) main.src = image.src;
        card.querySelectorAll('.thumbwrap').forEach(item => item.classList.remove('active'));
        thumb.classList.add('active');
      });
    });

    const addButton = card.querySelector('.cart-add');
    if (addButton && available) {
      addButton.addEventListener('click', () => {
        if (window.agregarAlCarrito) window.agregarAlCarrito(String(product.id), addButton);
      });
    }

    const payButton = card.querySelector('.pay-now');
    if (payButton && available) {
      payButton.addEventListener('click', () => {
        if (window.pagar) window.pagar(String(product.id), payButton);
        else window.location.href = '/checkout.html?cart=1';
      });
    }

    grid.appendChild(card);
  }

  function renderProducts(grid, products) {
    const activeProducts = products.filter(product => product && product.active !== false);
    if (!activeProducts.length) return false;
    grid.innerHTML = '';
    activeProducts.forEach((product, index) => renderProduct(grid, product, index));
    return true;
  }

  function setupCatalogControls(grid) {
    const search = document.getElementById('catalogSearch');
    const sort = document.getElementById('catalogSort');
    const count = document.getElementById('catalogCount');
    const empty = document.getElementById('catalogEmpty');
    if (!search || !sort || !count || !empty) return () => {};

    const update = () => {
      const query = normalize(search.value);
      const cards = [...grid.querySelectorAll('.card')];
      const visible = cards.filter(card => !query || String(card.dataset.search || '').includes(query));
      const hidden = cards.filter(card => !visible.includes(card));

      visible.sort((a, b) => {
        if (sort.value === 'price-asc') return Number(a.dataset.price) - Number(b.dataset.price);
        if (sort.value === 'price-desc') return Number(b.dataset.price) - Number(a.dataset.price);
        if (sort.value === 'name') return String(a.dataset.sortName).localeCompare(String(b.dataset.sortName), 'es');
        return Number(b.dataset.created) - Number(a.dataset.created) || Number(a.dataset.originalOrder) - Number(b.dataset.originalOrder);
      });

      visible.forEach(card => {
        card.hidden = false;
        grid.appendChild(card);
      });
      hidden.forEach(card => {
        card.hidden = true;
        grid.appendChild(card);
      });

      const total = visible.length;
      count.textContent = `${total} ${total === 1 ? 'figura' : 'figuras'}`;
      empty.hidden = total > 0;
      grid.hidden = total === 0;
    };

    search.addEventListener('input', update);
    sort.addEventListener('change', update);
    return update;
  }

  async function load() {
    enhanceStoreTrust();
    const grid = document.querySelector('#catalogo .grid');
    if (!grid) return;

    prepareExistingCards(grid);
    const refreshControls = setupCatalogControls(grid);
    refreshControls();

    const cachedProducts = readCache();
    if (cachedProducts.length && renderProducts(grid, cachedProducts)) refreshControls();

    try {
      const response = await fetch(`/api/productos?cb=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`Catálogo ${response.status}`);
      const data = await response.json();
      const products = Array.isArray(data.products) ? data.products : [];
      if (!products.length) throw new Error('Catálogo sin productos');
      saveCache(products);
      renderProducts(grid, products);
      refreshControls();
    } catch (error) {
      console.error('catalogo-dinamico api:', error);
      if (!grid.querySelector('[data-product-id="3431"]')) renderProduct(grid, FALLBACK_3431, grid.children.length);
      refreshControls();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
