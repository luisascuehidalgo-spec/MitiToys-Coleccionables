const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

let query;
require('../lib/db').getDb = () => query;
const productHandler = require('../api/admin-product');
const shippingHandler = require('../api/admin-shipping');

const A = 'https://res.cloudinary.com/test/image/upload/a.png';
const B = 'https://res.cloudinary.com/test/image/upload/b.png';
const C = 'https://res.cloudinary.com/test/image/upload/c.png';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseProduct() {
  return {
    id: 'QA-PERSIST-001',
    title: 'Producto QA',
    description: 'TEST ORIGINAL',
    price: 100000,
    stock_quantity: 7,
    stock_managed: true,
    active: true,
    images: [A, B],
    weight_kg: 1.25,
    package_length_cm: 30,
    package_width_cm: 25,
    package_height_cm: 35,
    updated_at: '2026-09-07T18:00:00.123Z'
  };
}

function adminBody(product, overrides = {}) {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    price: product.price,
    stock_quantity: product.stock_quantity,
    stock_managed: product.stock_managed,
    active: product.active,
    images: clone(product.images),
    original_images: clone(product.images),
    updated_at: product.updated_at,
    ...overrides
  };
}

function setupAuth(t) {
  const previous = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = 'qa-persistence-secret';
  t.after(() => {
    if (previous === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previous;
  });
}

function cookie() {
  const value = `admin:${Date.now()}`;
  const signature = createHmac('sha256', process.env.ADMIN_SESSION_SECRET || '').update(value).digest('hex');
  return 'mititoys_admin=' + Buffer.from(value + '.' + signature).toString('base64url');
}

async function call(handler, method, body) {
  const req = { method, body, headers: { cookie: cookie() } };
  const res = {
    code: 200,
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; },
    setHeader() {}
  };
  await handler(req, res);
  return res;
}

function sameMillisecond(a, b) {
  return Date.parse(a) === Date.parse(b);
}

function productDb(initial) {
  let state = clone(initial);
  const calls = [];
  query = async (strings, ...values) => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ sql, values: clone(values) });

    if (sql.startsWith('SELECT stock_quantity,images,weight_kg')) {
      return [{
        stock_quantity: state.stock_quantity,
        images: clone(state.images),
        weight_kg: state.weight_kg,
        package_length_cm: state.package_length_cm,
        package_width_cm: state.package_width_cm,
        package_height_cm: state.package_height_cm,
        updated_at: state.updated_at
      }];
    }

    if (sql.includes('COUNT(*)::int AS count FROM product_images')) return [{ count: 0 }];

    if (sql.startsWith('UPDATE products SET title=')) {
      const expectedVersion = values[12];
      const expectedImages = JSON.parse(values[13]);
      if (!sameMillisecond(state.updated_at, expectedVersion)) return [];
      if (JSON.stringify(state.images || []) !== JSON.stringify(expectedImages)) return [];
      state = {
        ...state,
        title: values[0],
        description: values[1],
        images: JSON.parse(values[2]),
        stock_quantity: values[3],
        stock_managed: values[4],
        active: values[5],
        price: values[6],
        weight_kg: values[7],
        package_length_cm: values[8],
        package_width_cm: values[9],
        package_height_cm: values[10],
        updated_at: '2026-09-07T18:01:00.456Z'
      };
      return [clone(state)];
    }

    if (sql.startsWith('INSERT INTO inventory_movements')) return [];
    throw new Error('Unexpected SQL: ' + sql);
  };
  return { calls, getState: () => clone(state), setState: value => { state = clone(value); } };
}

function shippingDb(initial) {
  let state = clone(initial);
  const calls = [];
  query = async (strings, ...values) => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ sql, values: clone(values) });
    if (sql.startsWith('SELECT id FROM products')) {
      return String(values[0]) === String(state.id) ? [{ id: state.id }] : [];
    }
    if (!sql.startsWith('UPDATE products SET weight_kg=')) throw new Error('Unexpected SQL: ' + sql);
    if (String(values[4]) !== String(state.id)) return [];
    if (!sameMillisecond(state.updated_at, values[5])) return [];
    state = {
      ...state,
      weight_kg: values[0],
      package_length_cm: values[1],
      package_width_cm: values[2],
      package_height_cm: values[3],
      updated_at: '2026-09-07T18:01:00.456Z'
    };
    return [clone(state)];
  };
  return { calls, getState: () => clone(state), setState: value => { state = clone(value); } };
}

function assertShippingUnchanged(actual, expected) {
  for (const key of ['weight_kg', 'package_length_cm', 'package_width_cm', 'package_height_cm']) {
    assert.equal(actual[key], expected[key], key + ' cambió sin autorización');
  }
}

function assertCoreUnchanged(actual, expected, except = []) {
  for (const key of ['title', 'description', 'price', 'stock_quantity', 'stock_managed', 'active', 'images']) {
    if (except.includes(key)) continue;
    assert.deepEqual(actual[key], expected[key], key + ' cambió sin autorización');
  }
}

test('A: editar precio conserva stock, logística, descripción, imágenes y estado', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = productDb(initial);
  const res = await call(productHandler, 'PUT', adminBody(initial, { price: 110000 }));
  assert.equal(res.code, 200);
  const actual = db.getState();
  assert.equal(actual.price, 110000);
  assertShippingUnchanged(actual, initial);
  assertCoreUnchanged(actual, initial, ['price']);
});

test('B: editar stock conserva precio, logística, descripción, imágenes y estado', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = productDb(initial);
  const res = await call(productHandler, 'PUT', adminBody(initial, { stock_quantity: 9 }));
  assert.equal(res.code, 200);
  const actual = db.getState();
  assert.equal(actual.stock_quantity, 9);
  assertShippingUnchanged(actual, initial);
  assertCoreUnchanged(actual, initial, ['stock_quantity']);
  assert.ok(db.calls.some(call => call.sql.startsWith('INSERT INTO inventory_movements')));
});

test('C: editar descripción conserva precio, stock, logística, imágenes y estado', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = productDb(initial);
  const res = await call(productHandler, 'PUT', adminBody(initial, { description: 'DESCRIPCIÓN NUEVA' }));
  assert.equal(res.code, 200);
  const actual = db.getState();
  assert.equal(actual.description, 'DESCRIPCIÓN NUEVA');
  assertShippingUnchanged(actual, initial);
  assertCoreUnchanged(actual, initial, ['description']);
});

test('D: editar imágenes conserva precio, stock, logística, descripción y estado', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = productDb(initial);
  const res = await call(productHandler, 'PUT', adminBody(initial, { images: [A, B, C] }));
  assert.equal(res.code, 200);
  const actual = db.getState();
  assert.deepEqual(actual.images, [A, B, C]);
  assertShippingUnchanged(actual, initial);
  assertCoreUnchanged(actual, initial, ['images']);
});

test('F: campos logísticos omitidos o undefined no se convierten en null', async t => {
  setupAuth(t);
  const initial = baseProduct();
  let db = productDb(initial);
  let res = await call(productHandler, 'PUT', adminBody(initial, { price: 110000 }));
  assert.equal(res.code, 200);
  assertShippingUnchanged(db.getState(), initial);

  db = productDb(initial);
  res = await call(productHandler, 'PUT', adminBody(initial, {
    weight_kg: undefined,
    package_length_cm: undefined,
    package_width_cm: undefined,
    package_height_cm: undefined
  }));
  assert.equal(res.code, 200);
  assertShippingUnchanged(db.getState(), initial);
});

test('G: null explícito en logística del PUT general se interpreta como conservar, no borrar', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = productDb(initial);
  const res = await call(productHandler, 'PUT', adminBody(initial, {
    weight_kg: null,
    package_length_cm: null,
    package_width_cm: null,
    package_height_cm: null
  }));
  assert.equal(res.code, 200);
  assertShippingUnchanged(db.getState(), initial);
});

test('I: una pestaña vieja no puede sobrescribir cambios de otra pestaña', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = productDb(initial);
  const newer = {
    ...initial,
    description: 'CAMBIO DESDE OTRA PESTAÑA',
    updated_at: '2026-09-07T18:05:00.999Z'
  };
  db.setState(newer);

  const res = await call(productHandler, 'PUT', adminBody(initial, { price: 110000 }));
  assert.equal(res.code, 409);
  assert.match(res.body.error, /cambió desde que abriste el panel/i);
  assert.deepEqual(db.getState(), newer);
  assert.ok(!db.calls.some(call => call.sql.startsWith('INSERT INTO inventory_movements')));
});

test('I2: PUT general rechaza clientes sin token de versión', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = productDb(initial);
  const body = adminBody(initial, { price: 110000 });
  delete body.updated_at;
  const res = await call(productHandler, 'PUT', body);
  assert.equal(res.code, 409);
  assert.match(res.body.error, /versión/i);
  assert.equal(db.calls.length, 0);
  assert.deepEqual(db.getState(), initial);
});

test('E: endpoint de logística actualiza solo las cuatro columnas logísticas', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = shippingDb(initial);
  const res = await call(shippingHandler, 'PATCH', {
    id: initial.id,
    updated_at: initial.updated_at,
    weight_kg: 1.5,
    package_length_cm: 31,
    package_width_cm: 26,
    package_height_cm: 36
  });
  assert.equal(res.code, 200);
  const actual = db.getState();
  assert.equal(actual.weight_kg, 1.5);
  assert.equal(actual.package_length_cm, 31);
  assert.equal(actual.package_width_cm, 26);
  assert.equal(actual.package_height_cm, 36);
  assertCoreUnchanged(actual, initial);

  const update = db.calls.find(call => call.sql.startsWith('UPDATE products'));
  assert.ok(update);
  for (const forbidden of ['title=', 'description=', 'images=', 'price=', 'stock_quantity=', 'stock_managed=', 'active=']) {
    assert.ok(!update.sql.includes(forbidden), 'shipping UPDATE incluye columna ajena: ' + forbidden);
  }
});

test('H: una pestaña de envíos no sobrescribe imágenes nuevas cuando guarda la versión actual', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = shippingDb({ ...initial, images: [A, B, C] });

  const res = await call(shippingHandler, 'PATCH', {
    id: initial.id,
    updated_at: initial.updated_at,
    weight_kg: 1.75,
    package_length_cm: 32,
    package_width_cm: 27,
    package_height_cm: 37
  });
  assert.equal(res.code, 200);
  assert.deepEqual(db.getState().images, [A, B, C]);

  const callsBefore = db.calls.length;
  const rejected = await call(shippingHandler, 'PATCH', {
    id: initial.id,
    updated_at: db.getState().updated_at,
    weight_kg: 1.8,
    package_length_cm: 33,
    package_width_cm: 28,
    package_height_cm: 38,
    images: [A, B]
  });
  assert.equal(rejected.code, 400);
  assert.equal(db.calls.length, callsBefore);
  assert.deepEqual(db.getState().images, [A, B, C]);
});

test('H2: una pestaña vieja de envíos no puede sobrescribir medidas nuevas', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const newer = {
    ...initial,
    weight_kg: 2.1,
    package_length_cm: 40,
    package_width_cm: 30,
    package_height_cm: 45,
    updated_at: '2026-09-07T18:05:00.999Z'
  };
  const db = shippingDb(newer);
  const res = await call(shippingHandler, 'PATCH', {
    id: initial.id,
    updated_at: initial.updated_at,
    weight_kg: 1.8,
    package_length_cm: 33,
    package_width_cm: 28,
    package_height_cm: 38
  });
  assert.equal(res.code, 409);
  assert.match(res.body.error, /cambió desde que abriste esta pantalla/i);
  assert.deepEqual(db.getState(), newer);
});

test('shipping PATCH exige los cuatro valores y rechaza null explícito', async t => {
  setupAuth(t);
  const initial = baseProduct();
  const db = shippingDb(initial);
  let res = await call(shippingHandler, 'PATCH', {
    id: initial.id,
    weight_kg: null,
    package_length_cm: 30,
    package_width_cm: 25,
    package_height_cm: 35
  });
  assert.equal(res.code, 400);
  assert.equal(db.calls.length, 0);

  res = await call(shippingHandler, 'PATCH', {
    id: initial.id,
    weight_kg: 1.25,
    package_length_cm: 30,
    package_width_cm: 25
  });
  assert.equal(res.code, 400);
  assert.equal(db.calls.length, 0);
});

function enviosContext(fetchImpl) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '',
      textContent: '',
      className: '',
      innerHTML: '',
      classList: { add() {}, remove() {} },
      addEventListener() {}
    });
    return nodes.get(id);
  };
  const storage = new Map();
  const context = vm.createContext({
    document: { getElementById: get },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    fetch: fetchImpl,
    location: { reload() {} },
    console
  });
  const html = fs.readFileSync(require.resolve('../admin-envios.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInContext(script, context);
  return { context, get };
}

test('admin-envios envía id + versión + logística al endpoint aislado', async () => {
  let patchPayload;
  const initial = baseProduct();
  const { context, get } = enviosContext(async (path, options = {}) => {
    if (path === '/api/admin-shipping') {
      patchPayload = JSON.parse(options.body);
      assert.equal(options.method, 'PATCH');
      return { ok: true, status: 200, json: async () => ({ product: { ...initial, ...patchPayload } }) };
    }
    if (String(path).startsWith('/api/admin?')) {
      return { ok: true, status: 200, json: async () => ({ products: [{ ...initial, ...patchPayload }] }) };
    }
    throw new Error('Unexpected fetch: ' + path);
  });

  vm.runInContext('products = ' + JSON.stringify([initial]), context);
  get('weight-' + initial.id).value = '1.50';
  get('length-' + initial.id).value = '31';
  get('width-' + initial.id).value = '26';
  get('height-' + initial.id).value = '36';
  await vm.runInContext(`save('${initial.id}')`, context);

  assert.deepEqual(Object.keys(patchPayload).sort(), [
    'id',
    'package_height_cm',
    'package_length_cm',
    'package_width_cm',
    'updated_at',
    'weight_kg'
  ].sort());
  assert.equal(patchPayload.id, initial.id);
  assert.equal(patchPayload.updated_at, initial.updated_at);
  assert.equal(patchPayload.weight_kg, 1.5);
  assert.equal(patchPayload.package_length_cm, 31);
  assert.equal(patchPayload.package_width_cm, 26);
  assert.equal(patchPayload.package_height_cm, 36);
});

function adminContext(fetchImpl) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', files: [], checked: false, disabled: false,
      textContent: '', className: '', innerHTML: '',
      classList: { add() {}, remove() {} }, addEventListener() {}
    });
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: get },
    fetch: fetchImpl,
    URL,
    Intl,
    console,
    location: { reload() {} },
    alert() {},
    confirm() { return true; }
  });
  const html = fs.readFileSync(require.resolve('../admin.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInContext(script, context);
  return { context, get };
}

test('admin general envía updated_at de la versión cargada', async () => {
  const initial = baseProduct();
  let putPayload;
  const { context, get } = adminContext(async (path, options = {}) => {
    if (path === '/api/admin-product' && options.method === 'PUT') {
      putPayload = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ product: { ...initial, ...putPayload, updated_at: '2026-09-07T18:01:00.456Z' } }) };
    }
    if (String(path).startsWith('/api/admin?')) {
      return { ok: true, status: 200, json: async () => ({ orders: [], customers: [], products: [initial] }) };
    }
    throw new Error('Unexpected fetch: ' + path);
  });

  vm.runInContext('data.products=' + JSON.stringify([initial]), context);
  for (const [id, value] of Object.entries({
    ['title-' + initial.id]: initial.title,
    ['price-' + initial.id]: String(initial.price),
    ['desc-' + initial.id]: initial.description,
    ['stock-' + initial.id]: String(initial.stock_quantity),
    ['legacy-' + initial.id]: initial.images.join('\n')
  })) get(id).value = value;
  get('managed-' + initial.id).checked = initial.stock_managed;
  get('active-' + initial.id).checked = initial.active;
  get('files-' + initial.id).files = [];
  get('ps-' + initial.id).textContent = '';

  await vm.runInContext(`saveProduct('${initial.id}')`, context);
  assert.ok(putPayload);
  assert.equal(putPayload.updated_at, initial.updated_at);
  assert.deepEqual(putPayload.original_images, initial.images);
});
