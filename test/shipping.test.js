const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePostalCode,
  normalizeProvinceCode,
  normalizeCart,
  cartHash,
  buildPackages,
  quoteEnviopack
} = require('../lib/shipping');

test('normaliza códigos postales y provincias argentinas', () => {
  assert.equal(normalizePostalCode('C1405ABC'), '1405');
  assert.equal(normalizePostalCode('5000'), '5000');
  assert.equal(normalizePostalCode('123'), '');
  assert.equal(normalizeProvinceCode('x'), 'X');
  assert.equal(normalizeProvinceCode('ZZ'), '');
});

test('agrupa el carrito y produce una huella estable', () => {
  const one = normalizeCart([{ id: '3377', qty: 1 }, { id: '3377', qty: 2 }, { id: '3375', qty: 1 }]);
  const two = normalizeCart([{ id: '3375', qty: 1 }, { id: '3377', qty: 3 }]);
  assert.deepEqual(one, two);
  assert.equal(cartHash(one), cartHash(two));
});

test('genera los bultos usando peso y medidas reales', () => {
  const products = [{ id: 'A', title: 'Figura A', weight_kg: '1.25', package_length_cm: '30', package_width_cm: '20', package_height_cm: '40' }];
  const result = buildPackages(products, [{ id: 'A', qty: 2 }]);
  assert.equal(result.missing.length, 0);
  assert.equal(result.packages.length, 2);
  assert.deepEqual(result.packages[0], { weight: 1.25, length: 30, width: 20, height: 40 });
});

test('informa productos sin información logística', () => {
  const result = buildPackages([{ id: 'A', title: 'Figura A' }], [{ id: 'A', qty: 1 }]);
  assert.deepEqual(result.missing, [{ id: 'A', title: 'Figura A' }]);
});

test('cotiza, filtra domicilio y conserva la tarifa más económica por correo y servicio', async () => {
  process.env.ENVIOPACK_API_KEY = 'test-key';
  process.env.ENVIOPACK_SECRET_KEY = 'test-secret';
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth')) return { ok: true, json: async () => ({ access_token: 'token' }) };
    if (String(url).includes('/validar-codigo-postal')) return { ok: true, json: async () => ({ valido: true }) };
    return {
      ok: true,
      json: async () => [
        { correo: { id: 'oca', nombre: 'OCA' }, modalidad: 'D', servicio: 'N', despacho: 'D', valor: '5000', horas_entrega: 72 },
        { correo: { id: 'oca', nombre: 'OCA' }, modalidad: 'D', servicio: 'N', despacho: 'S', valor: '4500', horas_entrega: 72 },
        { correo: { id: 'andreani', nombre: 'Andreani' }, modalidad: 'D', servicio: 'N', despacho: 'D', valor: '6000', horas_entrega: 48 },
        { correo: { id: 'oca', nombre: 'OCA' }, modalidad: 'S', servicio: 'N', valor: '1000', horas_entrega: 24 }
      ]
    };
  };
  try {
    const rates = await quoteEnviopack({ provinceCode: 'C', postalCode: '1405', packages: [{ weight: 1.5, height: 40, width: 20, length: 30 }] });
    assert.equal(rates.length, 2);
    assert.equal(rates[0].carrierName, 'OCA');
    assert.equal(rates[0].amount, 4500);
    assert.match(calls[1].url, /provincias\/C\/validar-codigo-postal/);
    assert.match(calls[2].url, /provincia=C/);
    assert.match(calls[2].url, /codigo_postal=1405/);
    assert.match(calls[2].url, /paquetes=40x20x30/);
  } finally {
    global.fetch = originalFetch;
    delete process.env.ENVIOPACK_API_KEY;
    delete process.env.ENVIOPACK_SECRET_KEY;
  }
});
