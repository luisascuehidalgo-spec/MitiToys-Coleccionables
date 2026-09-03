(() => {
  const KEY = 'mititoys_cart';
  const read = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(x => x && x.id && Number(x.qty) > 0).map(x => ({ id: String(x.id), qty: Math.max(1, Math.floor(Number(x.qty) || 1)) })) : [];
    } catch (_) { return []; }
  };
  const save = cart => localStorage.setItem(KEY, JSON.stringify(cart));
  const totalQty = cart => cart.reduce((n, x) => n + x.qty, 0);
  window.MitiToysCart = {
    get: read,
    count: () => totalQty(read()),
    add(id, qty = 1) {
      const cart = read();
      const key = String(id);
      const found = cart.find(x => x.id === key);
      if (found) found.qty += Math.max(1, Math.floor(Number(qty) || 1));
      else cart.push({ id: key, qty: Math.max(1, Math.floor(Number(qty) || 1)) });
      save(cart); updateBadges(); return cart;
    },
    remove(id) { const cart = read().filter(x => x.id !== String(id)); save(cart); updateBadges(); return cart; },
    setQty(id, qty) {
      const cart = read(); const found = cart.find(x => x.id === String(id));
      if (!found) return cart;
      const value = Math.floor(Number(qty) || 0);
      if (value <= 0) return this.remove(id);
      found.qty = value; save(cart); updateBadges(); return cart;
    },
    clear() { save([]); updateBadges(); }
  };

  function updateBadges() {
    const count = window.MitiToysCart.count();
    document.querySelectorAll('[data-cart-count]').forEach(el => { el.textContent = count; el.hidden = count < 1; });
    document.querySelectorAll('a.cart').forEach(el => { el.href = '/carrito.html'; el.textContent = `🛒 Carrito${count ? ` (${count})` : ''}`; });
  }

  function addButtonsToExistingCards() {
    document.querySelectorAll('#catalogo .card').forEach(card => {
      if (card.querySelector('.cart-add')) return;
      const badge = card.querySelector('.badge');
      const pay = card.querySelector('.paybtn');
      if (!badge || !pay) return;
      const id = badge.textContent.replace(/^COD\s*/i, '').trim();
      if (!id) return;
      const btn = document.createElement('button');
      btn.className = 'paybtn cart-add';
      btn.type = 'button';
      btn.textContent = '🛒 AGREGAR AL CARRITO';
      btn.onclick = () => window.agregarAlCarrito(id, btn);
      pay.parentNode.insertBefore(btn, pay);
    });
  }

  window.agregarAlCarrito = (id, button) => {
    window.MitiToysCart.add(id, 1);
    if (button) {
      const old = button.textContent;
      button.textContent = '✓ AGREGADO AL CARRITO';
      button.disabled = true;
      setTimeout(() => { button.textContent = old; button.disabled = false; }, 1100);
    }
  };

  document.addEventListener('DOMContentLoaded', () => { addButtonsToExistingCards(); updateBadges(); });
  const observer = new MutationObserver(() => { addButtonsToExistingCards(); updateBadges(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  updateBadges();
})();
