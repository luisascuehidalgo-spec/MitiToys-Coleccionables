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

async function findPaymentsByExternalReference(externalReference) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error('Mercado Pago no está configurado.'), { code: 'MP_NOT_CONFIGURED' });

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

module.exports = {
  PUBLIC_BASE_URL,
  PREFERENCE_TTL_MS,
  ABANDONED_RELEASE_GRACE_MS,
  OFFLINE_PAYMENT_TTL_MS,
  preferenceWindow,
  findPaymentsByExternalReference
};
