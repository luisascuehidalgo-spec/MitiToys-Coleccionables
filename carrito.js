(() => {
  const KEY = 'mititoys_cart';
  const STOCK_NOTICE_KEY = 'mititoys_cart_stock_notice';

  const read = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw)
        ? raw
            .filter(x => x && x.id && Number(x.qty) > 0)
            .map(x => ({ id: String(x.id), qty: Math.max(1, Math.floor(Number(x.qty) || 1)) }))
        : [];
    } catch (_) {
      return [];
    }
  };

  const save = cart => localStorage.setItem(KEY, JSON.stringify(cart));

  const updateBadges = () => {
    const count = read().reduce((n, x) => n + x.qty, 0);

    document.querySelectorAll('[data-cart-count]').forEach(el => {
      const nextText = String(count);
      if (el.textContent !== nextText) el.textContent = nextText;
      el.hidden = count < 1;
    });

    document.querySelectorAll('a.cart').forEach(el => {
      const nextText = count ? `🛒 Carrito (${count})` : '🛒 Carrito';
      if (el.getAttribute('href') !== '/carrito.html') el.setAttribute('href', '/carrito.html');
      if (el.textContent !== nextText) el.textContent = nextText;
    });
  };

  function showStockNotice() {
    if (!window.location.pathname.endsWith('/carrito.html')) return;
    let message = '';
    try {
      message = sessionStorage.getItem(STOCK_NOTICE_KEY) || '';
      sessionStorage.removeItem(STOCK_NOTICE_KEY);
    } catch (_) {
      return;
    }
    if (!message) return;
    const cart = document.getElementById('cart');
    if (!cart?.parentNode) return;
    const notice = document.createElement('div');
    notice.className = 'cart-warning';
    notice.setAttribute('role', 'status');
    notice.textContent = message;
    cart.parentNode.insertBefore(notice, cart);
  }

  async function guardCheckoutStock() {
    if (!window.location.pathname.endsWith('/checkout.html')) return;
    const cart = read();
    if (!cart.length) return;
    try {
      const response = await fetch('/api/productos', {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) return;
      const data = await response.json();
      const products = Array.isArray(data.products) ? data.products : [];
      const invalid = cart.find(item => {
        const product = products.find(candidate => String(candidate.id) === item.id);
        if (!product) return true;
        if (!product.stock_managed) return false;
        const available = Math.max(0, Math.floor(Number(product.stock_quantity) || 0));
        return item.qty > available;
      });
      if (!invalid) return;
      try {
        sessionStorage.setItem(STOCK_NOTICE_KEY, 'El stock cambió desde que armaste el carrito. Revisamos las cantidades disponibles antes de continuar.');
      } catch (_) {
        // Redirecting to the cart is still safe if session storage is unavailable.
      }
      window.location.replace('/carrito.html');
    } catch (_) {
      // Advisory check only. The checkout API remains the authoritative stock guard.
    }
  }

  window.MitiToysCart = {
    get: read,
    count: () => read().reduce((n, x) => n + x.qty, 0),
    add(id, qty = 1) {
      const cart = read();
      const key = String(id);
      const numericQty = Math.floor(Number(qty));
      const amount = Number.isFinite(numericQty) && numericQty > 0 ? numericQty : 1;
      const found = cart.find(x => x.id === key);

      if (found) found.qty += amount;
      else cart.push({ id: key, qty: amount });

      save(cart);
      updateBadges();
      window.MitiToysAnalytics?.track('add_to_cart', { product_id: key, quantity: amount });
      return cart;
    },
    remove(id) {
      const cart = read().filter(x => x.id !== String(id));
      save(cart);
      updateBadges();
      window.MitiToysAnalytics?.track('remove_from_cart', { product_id: String(id) });
      return cart;
    },
    prune(validIds) {
      const allowed = validIds instanceof Set
        ? new Set(Array.from(validIds, value => String(value)))
        : new Set(Array.from(validIds || [], value => String(value)));
      const cart = read();
      const next = cart.filter(item => allowed.has(item.id));
      if (next.length !== cart.length) {
        save(next);
        updateBadges();
      }
      return next;
    },
    setQty(id, qty) {
      const cart = read();
      const found = cart.find(x => x.id === String(id));
      if (!found) return cart;

      const value = Math.floor(Number(qty) || 0);
      if (value <= 0) return this.remove(id);

      found.qty = value;
      save(cart);
      updateBadges();
      return cart;
    },
    clear() {
      save([]);
      updateBadges();
    }
  };

  window.agregarAlCarrito = (id, button) => {
    window.MitiToysCart.add(id, 1);

    if (button) {
      const old = button.textContent;
      button.textContent = '✓ AGREGADO AL CARRITO';
      button.disabled = true;
      setTimeout(() => {
        button.textContent = old;
        button.disabled = false;
      }, 1100);
    }
  };

  window.pagar = (id, button) => {
    window.MitiToysCart.add(id, 1);
    if (button) {
      button.disabled = true;
      button.textContent = '⏳ ABRIENDO CHECKOUT...';
    }
    window.location.href = '/checkout.html?cart=1';
  };

  function init() {
    updateBadges();
    showStockNotice();
    void guardCheckoutStock();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.addEventListener('storage', event => {
    if (event.key === KEY) updateBadges();
  });
})();
