const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'carrito.js'), 'utf8');
const orderPage = fs.readFileSync(path.join(__dirname, '..', 'pedido.html'), 'utf8');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump(key) { return values.get(key); }
  };
}

function loadCart(storage, pathname = '/checkout.html') {
  const window = {
    location: { pathname, href: '', replace() {} },
    addEventListener() {},
    MitiToysAnalytics: null
  };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll() { return []; },
    getElementById() { return null; }
  };
  const context = vm.createContext({ window, document, localStorage: storage, sessionStorage: createStorage(), fetch: async () => ({ ok: false }), setTimeout, URL, Set, Map, Array, Number, String, JSON, Date, Math });
  vm.runInContext(source, context);
  return window.MitiToysCart;
}

test('checkout keeps the cart until a verified paid order confirms the same items', () => {
  const storage = createStorage({ mititoys_cart: JSON.stringify([{ id: 'luffy', qty: 2 }, { id: 'zoro', qty: 1 }]) });
  const cart = loadCart(storage);

  cart.clear();
  assert.deepEqual(JSON.parse(storage.dump('mititoys_cart')), [{ id: 'luffy', qty: 2 }, { id: 'zoro', qty: 1 }]);
  assert.ok(storage.dump('mititoys_pending_checkout_cart'));

  cart.add('luffy', 1);
  cart.add('nami', 1);
  assert.equal(cart.finalizePendingCheckout([{ product_id: 'luffy', quantity: 2 }, { product_id: 'zoro', quantity: 1 }]), true);
  assert.deepEqual(JSON.parse(storage.dump('mititoys_cart')), [{ id: 'luffy', qty: 1 }, { id: 'nami', qty: 1 }]);
  assert.equal(storage.dump('mititoys_pending_checkout_cart'), undefined);
});

test('a different verified order cannot consume a pending checkout cart', () => {
  const storage = createStorage({ mititoys_cart: JSON.stringify([{ id: 'luffy', qty: 1 }]) });
  const cart = loadCart(storage);
  cart.clear();

  assert.equal(cart.finalizePendingCheckout([{ product_id: 'ace', quantity: 1 }]), false);
  assert.deepEqual(JSON.parse(storage.dump('mititoys_cart')), [{ id: 'luffy', qty: 1 }]);
  assert.ok(storage.dump('mititoys_pending_checkout_cart'));
});

test('order page finalizes only after an authenticated order lookup returns a paid state', () => {
  assert.match(orderPage, /carrito\.js\?v=9/);
  assert.match(orderPage, /paidStates=new Set\(\['approved','processing','shipped','delivered','refunded'\]\)/);
  const lookupIndex = orderPage.indexOf("fetch('/api/estado-pedido'");
  const statusIndex = orderPage.indexOf('paidStates.has(o.status)');
  const finalizeIndex = orderPage.indexOf('finalizePendingCheckout(o.items)');
  assert.ok(lookupIndex >= 0 && statusIndex > lookupIndex && finalizeIndex > statusIndex);
  assert.doesNotMatch(orderPage, /paidStates=new Set\([^)]*pending/);
  assert.doesNotMatch(orderPage, /paidStates=new Set\([^)]*cancelled/);
});
