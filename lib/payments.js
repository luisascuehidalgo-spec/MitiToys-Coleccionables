const PUBLIC_BASE_URL = 'https://mititoys.com';
const PREFERENCE_TTL_MS = 24 * 60 * 60 * 1000;
const ABANDONED_RELEASE_GRACE_MS = 2 * 60 * 60 * 1000;
const OFFLINE_PAYMENT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function preferenceWindow(now = new Date()) {
  const start = new Date(now);
  const end = new Date(start.getTime() + PREFERENCE_TTL_MS);
  const offlineEnd = new Date(start.getTime() + OFFLINE_PAYMENT_TTL_MS);
  return {
    expires: true,
    expiration_date_from: start.toISOString(),
    expiration_date_to: end.toISOString(),
    date_of_expiration: offlineEnd.toISOString()
  };
}

function mercadoPagoToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error('Mercado Pago no está configurado.'), { code: 'MP_NOT_CONFIGURED' });
  return token;
}

async function findPaymentsByExternalReference(externalReference) {
  const token = mercadoPagoToken();
  const url = new URL('https://api.mercadopago.com/v1/payments/search');
  url.searchParams.set('sort', 'date_created');
  url.searchParams.set('criteria', 'desc');
  url.searchParams.set('external_reference', String(externalReference || ''));
  url.searchParams.set('limit', '10');

  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (_) {
    throw Object.assign(new Error('No se pudo verificar Mercado Pago.'), { code: 'MP_PAYMENT_SEARCH_FAILED' });
  }

  if (!response.ok) {
    throw Object.assign(new Error('No se pudo verificar Mercado Pago.'), {
      code: 'MP_PAYMENT_SEARCH_FAILED',
      providerStatus: response.status
    });
  }

  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.results) ? data.results : [];
}

async function expirePreference(preferenceId, now = new Date()) {
  const token = mercadoPagoToken();
  const id = String(preferenceId || '').trim();
  if (!id) return false;

  let response;
  try {
    response = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ expires: true, expiration_date_to: new Date(now).toISOString() })
    });
  } catch (_) {
    throw Object.assign(new Error('No se pudo cancelar el enlace de pago.'), { code: 'MP_PREFERENCE_EXPIRE_FAILED' });
  }

  if (!response.ok) {
    throw Object.assign(new Error('No se pudo cancelar el enlace de pago.'), {
      code: 'MP_PREFERENCE_EXPIRE_FAILED',
      providerStatus: response.status
    });
  }
  return true;
}

module.exports = {
  PUBLIC_BASE_URL,
  PREFERENCE_TTL_MS,
  ABANDONED_RELEASE_GRACE_MS,
  OFFLINE_PAYMENT_TTL_MS,
  preferenceWindow,
  findPaymentsByExternalReference,
  expirePreference
};
