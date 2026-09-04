const crypto = require('crypto');

const PROVINCES = new Map([
  ['A', 'Salta'], ['B', 'Buenos Aires'], ['C', 'Ciudad Autónoma de Buenos Aires'],
  ['D', 'San Luis'], ['E', 'Entre Ríos'], ['F', 'La Rioja'],
  ['G', 'Santiago del Estero'], ['H', 'Chaco'], ['J', 'San Juan'],
  ['K', 'Catamarca'], ['L', 'La Pampa'], ['M', 'Mendoza'],
  ['N', 'Misiones'], ['P', 'Formosa'], ['Q', 'Neuquén'],
  ['R', 'Río Negro'], ['S', 'Santa Fe'], ['T', 'Tucumán'],
  ['U', 'Chubut'], ['V', 'Tierra del Fuego'], ['W', 'Corrientes'],
  ['X', 'Córdoba'], ['Y', 'Jujuy'], ['Z', 'Santa Cruz']
]);

const SERVICE_NAMES = {
  N: 'Estándar',
  P: 'Prioritario',
  X: 'Exprés',
  R: 'Devolución'
};

let tokenCache = null;

function shippingEnabled() {
  return Boolean(process.env.ENVIOPACK_API_KEY && process.env.ENVIOPACK_SECRET_KEY);
}

function normalizePostalCode(value) {
  const match = String(value || '').toUpperCase().match(/\d{4}/);
  return match ? match[0] : '';
}

function normalizeProvinceCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return PROVINCES.has(code) ? code : '';
}

function normalizeCart(rawItems) {
  const grouped = new Map();
  for (const item of Array.isArray(rawItems) ? rawItems : []) {
    const id = String(item?.id || '').trim();
    const quantity = Math.max(1, Math.min(20, Math.floor(Number(item?.qty) || 1)));
    if (id) grouped.set(id, Math.min(20, (grouped.get(id) || 0) + quantity));
  }
  return [...grouped.entries()]
    .map(([id, qty]) => ({ id, qty }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 20);
}

function cartHash(items) {
  const normalized = normalizeCart(items);
  return crypto.createHash('sha256').update(normalized.map(x => `${x.id}:${x.qty}`).join('|')).digest('hex');
}

function productPackage(product) {
  const weight = Number(product.weight_kg);
  const length = Number(product.package_length_cm);
  const width = Number(product.package_width_cm);
  const height = Number(product.package_height_cm);
  if (![weight, length, width, height].every(n => Number.isFinite(n) && n > 0)) return null;
  return {
    weight: Math.round(weight * 1000) / 1000,
    length: Math.ceil(length),
    width: Math.ceil(width),
    height: Math.ceil(height)
  };
}

function buildPackages(products, items) {
  const byId = new Map(products.map(product => [String(product.id), product]));
  const packages = [];
  const missing = [];
  for (const item of normalizeCart(items)) {
    const product = byId.get(item.id);
    if (!product) continue;
    const dimensions = productPackage(product);
    if (!dimensions) {
      missing.push({ id: item.id, title: String(product.title || item.id) });
      continue;
    }
    for (let index = 0; index < item.qty; index += 1) packages.push(dimensions);
  }
  return { packages, missing };
}

async function getEnviopackToken() {
  if (!shippingEnabled()) throw Object.assign(new Error('Envíopack no está configurado.'), { code: 'SHIPPING_NOT_CONFIGURED' });
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;

  const body = new URLSearchParams({
    'api-key': process.env.ENVIOPACK_API_KEY,
    'secret-key': process.env.ENVIOPACK_SECRET_KEY
  });
  const response = await fetch('https://api.enviopack.com/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000)
  });
  const data = await response.json().catch(() => ({}));
  const token = String(data.access_token || data.token || '').trim();
  if (!response.ok || !token) {
    console.error('Enviopack auth error:', response.status);
    throw Object.assign(new Error('No se pudo autenticar el servicio de envíos.'), { code: 'SHIPPING_PROVIDER_ERROR' });
  }
  tokenCache = { value: token, expiresAt: Date.now() + 3.5 * 60 * 60 * 1000 };
  return tokenCache.value;
}

function bestUniqueRates(rawRates) {
  const unique = new Map();
  for (const raw of Array.isArray(rawRates) ? rawRates : []) {
    if (String(raw?.modalidad || '').toUpperCase() !== 'D') continue;
    const amount = Number(raw?.valor);
    const carrierId = String(raw?.correo?.id || '').trim();
    const carrierName = String(raw?.correo?.nombre || '').trim();
    const serviceCode = String(raw?.servicio || 'N').toUpperCase();
    if (!carrierId || !carrierName || !Number.isFinite(amount) || amount < 0) continue;
    const rate = {
      carrierId,
      carrierName,
      serviceCode,
      serviceName: SERVICE_NAMES[serviceCode] || 'Envío a domicilio',
      dispatchMode: String(raw?.despacho || ''),
      amount: Math.round(amount * 100) / 100,
      estimatedHours: Number.isFinite(Number(raw?.horas_entrega)) ? Math.max(1, Math.round(Number(raw.horas_entrega))) : null,
      compliance: Number.isFinite(Number(raw?.cumplimiento)) ? Number(raw.cumplimiento) : null
    };
    const key = `${carrierId}:${serviceCode}`;
    const previous = unique.get(key);
    if (!previous || rate.amount < previous.amount) unique.set(key, rate);
  }
  return [...unique.values()]
    .sort((a, b) => a.amount - b.amount || (a.estimatedHours || Infinity) - (b.estimatedHours || Infinity))
    .slice(0, 6);
}

async function quoteEnviopack({ provinceCode, postalCode, packages }) {
  const token = await getEnviopackToken();
  const validationParams = new URLSearchParams({ access_token: token, codigo_postal: postalCode });
  const validationResponse = await fetch(`https://api.enviopack.com/provincias/${encodeURIComponent(provinceCode)}/validar-codigo-postal?${validationParams.toString()}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  });
  const validation = await validationResponse.json().catch(() => null);
  if (!validationResponse.ok) {
    console.error('Enviopack destination validation error:', validationResponse.status, validation);
    throw Object.assign(new Error('No se pudo validar el código postal.'), { code: 'SHIPPING_PROVIDER_ERROR' });
  }
  if (validation?.valido !== true) {
    throw Object.assign(new Error('El código postal no corresponde a la provincia seleccionada.'), { code: 'DESTINATION_MISMATCH' });
  }
  const totalWeight = packages.reduce((sum, item) => sum + item.weight, 0);
  const packageParam = packages.map(item => `${item.height}x${item.width}x${item.length}`).join(',');
  const params = new URLSearchParams({
    access_token: token,
    provincia: provinceCode,
    codigo_postal: postalCode,
    peso: totalWeight.toFixed(2),
    paquetes: packageParam,
    modalidad: 'D',
    orden_columna: 'valor',
    orden_sentido: 'asc'
  });
  if (process.env.ENVIOPACK_DEPOSIT_ID) params.set('direccion_envio', process.env.ENVIOPACK_DEPOSIT_ID);
  const response = await fetch(`https://api.enviopack.com/cotizar/costo?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('Enviopack quote error:', response.status, data);
    throw Object.assign(new Error('El correo no pudo calcular el envío en este momento.'), { code: 'SHIPPING_PROVIDER_ERROR' });
  }
  const rates = bestUniqueRates(data);
  if (!rates.length) throw Object.assign(new Error('No hay envíos a domicilio disponibles para ese destino.'), { code: 'NO_SHIPPING_RATES' });
  return rates;
}

module.exports = {
  PROVINCES,
  SERVICE_NAMES,
  shippingEnabled,
  normalizePostalCode,
  normalizeProvinceCode,
  normalizeCart,
  cartHash,
  buildPackages,
  quoteEnviopack
};
