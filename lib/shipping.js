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


async function enviopackJson(path, options = {}) {
  const token = await getEnviopackToken();
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`https://api.enviopack.com${path}${separator}access_token=${encodeURIComponent(token)}`, {
    method: options.method || 'GET',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || 12000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const providerMessage = String(data?.mensaje || data?.message || data?.error || '').slice(0, 350);
    throw Object.assign(new Error(providerMessage || 'Envíopack no pudo procesar la solicitud.'), {
      code: response.status === 402 || /saldo|fondos|balance/i.test(providerMessage) ? 'INSUFFICIENT_SHIPPING_BALANCE' : 'SHIPPING_PROVIDER_ERROR',
      providerStatus: response.status
    });
  }
  return data;
}

let depositCache = null;
async function resolveDepositId() {
  if (process.env.ENVIOPACK_DEPOSIT_ID) return String(process.env.ENVIOPACK_DEPOSIT_ID);
  if (depositCache && depositCache.expiresAt > Date.now()) return depositCache.id;
  const data = await enviopackJson('/direcciones-de-envio');
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.items) ? data.items : [];
  const selected = list.find(item => item.predeterminada === true || item.default === true) || list[0];
  const id = String(selected?.id || '').trim();
  if (!id) throw Object.assign(new Error('Configurá un depósito o dirección de retiro en Envíopack.'), { code: 'SHIPPING_DEPOSIT_MISSING' });
  depositCache = { id, expiresAt: Date.now() + 3600000 };
  return id;
}

async function listLocalities(provinceCode) {
  const data = await enviopackJson(`/localidades?id_provincia=${encodeURIComponent(provinceCode)}`);
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return list.map(item => ({ id: String(item.id || ''), name: String(item.nombre || item.name || '') }))
    .filter(item => item.id && item.name).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function quoteEnviopackBranch({ provinceCode, localityId, packages }) {
  const totalWeight = packages.reduce((sum, item) => sum + item.weight, 0);
  const packageParam = packages.map(item => `${item.height}x${item.width}x${item.length}`).join(',');
  const params = new URLSearchParams({
    provincia: provinceCode,
    localidad: String(localityId),
    peso: totalWeight.toFixed(2),
    paquetes: packageParam
  });
  if (process.env.ENVIOPACK_DEPOSIT_ID) params.set('direccion_envio', process.env.ENVIOPACK_DEPOSIT_ID);
  const data = await enviopackJson(`/cotizar/precio/a-sucursal?${params.toString()}`);
  const rates = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const branch = raw?.sucursal;
    const amount = Number(raw?.valor);
    const carrierId = String(branch?.correo?.id || '').trim();
    const carrierName = String(branch?.correo?.nombre || '').trim();
    const branchId = String(branch?.id || '').trim();
    if (!branchId || !carrierId || !carrierName || !Number.isFinite(amount) || amount < 0) continue;
    const serviceCode = String(raw?.servicio || 'N').toUpperCase();
    rates.push({
      carrierId, carrierName, serviceCode,
      serviceName: SERVICE_NAMES[serviceCode] || 'Retiro en sucursal',
      dispatchMode: String(raw?.despacho || 'D').toUpperCase(),
      amount: Math.round(amount * 100) / 100,
      estimatedHours: Number.isFinite(Number(raw?.horas_entrega)) ? Math.max(1, Math.round(Number(raw.horas_entrega))) : null,
      branch: {
        id: branchId,
        name: String(branch.nombre || 'Sucursal'),
        address: [branch.calle, branch.numero].filter(Boolean).join(' ').trim(),
        postalCode: normalizePostalCode(branch.codigo_postal),
        schedule: String(branch.horario || ''),
        localityId: String(branch.localidad?.id || localityId),
        localityName: String(branch.localidad?.nombre || '')
      }
    });
  }
  rates.sort((a, b) => a.amount - b.amount || (a.estimatedHours || Infinity) - (b.estimatedHours || Infinity));
  if (!rates.length) throw Object.assign(new Error('No hay sucursales disponibles para esa localidad.'), { code: 'NO_SHIPPING_RATES' });
  return rates.slice(0, 12);
}

function splitName(fullName) {
  const parts = String(fullName || 'Cliente Mititoys').trim().split(/\s+/);
  return { firstName: (parts.shift() || 'Cliente').slice(0, 30), lastName: (parts.join(' ') || 'Mititoys').slice(0, 30) };
}

async function getOrCreateEnviopackOrder({ order, customer, items }) {
  try {
    const found = await enviopackJson('/pedidos/obtener-ids', {
      method: 'POST',
      body: { id_externo: String(order.order_number).slice(0, 30), plataforma: 'web' }
    });
    if (found?.id_pedido) return String(found.id_pedido);
  } catch (error) {
    if (![400, 404].includes(error.providerStatus)) throw error;
  }
  const names = splitName(customer.name || order.shipping_recipient);
  const data = await enviopackJson('/pedidos', {
    method: 'POST',
    body: {
      id_externo: String(order.order_number).slice(0, 30),
      nombre: names.firstName,
      apellido: names.lastName,
      email: String(customer.email || '').slice(0, 100),
      telefono: String(customer.phone || order.shipping_phone || '').slice(0, 30) || undefined,
      celular: String(customer.phone || order.shipping_phone || '').slice(0, 30) || undefined,
      monto: Math.round(Number(order.total_amount || 0) * 100) / 100,
      fecha_alta: new Date(order.created_at || Date.now()).toISOString().replace('T', ' ').slice(0, 19),
      pagado: true,
      provincia: normalizeProvinceCode(order.shipping_province_code || order.shipping_province) || undefined,
      localidad: String(order.shipping_city || '').slice(0, 50) || undefined,
      productos: process.env.ENVIOPACK_USE_PRODUCT_CATALOG === 'true' ? items.map(item => ({ tipo_identificador: 'SKU', identificador: String(item.product_id).slice(0, 50), cantidad: Number(item.quantity || 1) })) : undefined
    }
  });
  if (!data?.id) throw Object.assign(new Error('Envíopack no devolvió el identificador del pedido.'), { code: 'SHIPPING_PROVIDER_ERROR' });
  return String(data.id);
}

async function createConfirmedShipment({ providerOrderId, order, packages, quote }) {
  const depositId = await resolveDepositId();
  const modality = order.shipping_destination_type === 'branch' ? 'S' : 'D';
  const payload = {
    pedido: Number(providerOrderId),
    direccion_envio: Number.isFinite(Number(depositId)) ? Number(depositId) : depositId,
    destinatario: String(order.shipping_recipient || '').slice(0, 50),
    observaciones: String(order.shipping_notes || '').slice(0, 250) || undefined,
    confirmado: true,
    tiene_fulfillment: false,
    modalidad: modality,
    servicio: String(quote.service_code || 'N'),
    correo: String(quote.carrier_id || order.shipping_carrier_id || ''),
    despacho: ['D', 'S'].includes(String(quote.dispatch_mode || '').toUpperCase()) ? String(quote.dispatch_mode).toUpperCase() : 'D',
    paquetes: packages.map((item, index) => ({
      alto: Math.ceil(Number(item.height)),
      ancho: Math.ceil(Number(item.width)),
      largo: Math.ceil(Number(item.length)),
      peso: Math.round(Number(item.weight) * 100) / 100,
      descripcion_primera_linea: String(order.order_number).slice(0, 50),
      descripcion_segunda_linea: `Bulto ${index + 1} de ${packages.length}`.slice(0, 50)
    }))
  };
  if (modality === 'S') {
    payload.sucursal = Number.isFinite(Number(order.shipping_branch_id)) ? Number(order.shipping_branch_id) : order.shipping_branch_id;
  } else {
    Object.assign(payload, {
      calle: String(order.shipping_street || '').slice(0, 50),
      numero: String(order.shipping_number || '').slice(0, 5),
      piso: String(order.shipping_floor || '').slice(0, 6) || undefined,
      depto: String(order.shipping_unit || '').slice(0, 4) || undefined,
      referencia_domicilio: String(order.shipping_notes || '').slice(0, 30) || undefined,
      codigo_postal: normalizePostalCode(order.shipping_postal_code),
      provincia: normalizeProvinceCode(order.shipping_province_code || order.shipping_province),
      localidad: String(order.shipping_city || '').slice(0, 50)
    });
  }
  const data = await enviopackJson('/envios', { method: 'POST', body: payload, timeout: 15000 });
  if (!data?.id) throw Object.assign(new Error('Envíopack no devolvió el identificador del envío.'), { code: 'SHIPPING_PROVIDER_ERROR' });
  return data;
}

async function getShipment(shipmentId) {
  return enviopackJson(`/envios/${encodeURIComponent(shipmentId)}`);
}

async function getShipmentTracking(shipmentId) {
  const data = await enviopackJson(`/envios/${encodeURIComponent(shipmentId)}/tracking?formato=iso&orden=asc`);
  return Array.isArray(data) ? data : [];
}

async function getShipmentLabel(shipmentId) {
  const token = await getEnviopackToken();
  return fetch(`https://api.enviopack.com/envios/${encodeURIComponent(shipmentId)}/etiqueta?access_token=${encodeURIComponent(token)}&formato=pdf`, {
    headers: { Accept: 'application/pdf' },
    signal: AbortSignal.timeout(15000)
  });
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
  quoteEnviopack,
  listLocalities,
  quoteEnviopackBranch,
  getEnviopackToken,
  getOrCreateEnviopackOrder,
  createConfirmedShipment,
  getShipment,
  getShipmentTracking,
  getShipmentLabel,
  resolveDepositId
};
