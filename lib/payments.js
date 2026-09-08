const PUBLIC_BASE_URL = 'https://mititoys.com';
const PREFERENCE_TTL_MS = 24 * 60 * 60 * 1000;
const ABANDONED_RELEASE_GRACE_MS = 2 * 60 * 60 * 1000;
const OFFLINE_PAYMENT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PREFERENCE_CREATE_TIMEOUT_MS = 8000;
const PREFERENCE_LOOKUP_TIMEOUT_MS = 6000;
const PAYMENT_LOOKUP_TIMEOUT_MS = 6000;

const NON_RESERVATION_PAYMENT_STATUSES = new Set(['rejected', 'cancelled', 'canceled']);

function normalizePaymentStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

function paymentsRequireReservation(payments) {
  const list = Array.isArray(payments) ? payments.filter(Boolean) : [];
  if (!list.length) return false;
  return list.some(payment => !NON_RESERVATION_PAYMENT_STATUSES.has(normalizePaymentStatus(payment?.status)));
}

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

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function findPaymentsByExternalReference(externalReference) {
  const token = mercadoPagoToken();
  const url = new URL('https://api.mercadopago.com/v1/payments/search');
  url.searchParams.set('sort', 'date_created');
  url.searchParams.set('criteria', 'desc');
  url.searchParams.set('external_reference', String(externalReference || ''));
  url.searchParams.set('limit', '10');

  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: timeoutSignal(PREFERENCE_LOOKUP_TIMEOUT_MS) });
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

async function getPayment(paymentId) {
  const token = mercadoPagoToken();
  const id = String(paymentId || '').trim();
  if (!id) throw Object.assign(new Error('Falta identificar el pago de Mercado Pago.'), { code: 'MP_PAYMENT_LOOKUP_FAILED' });

  let response;
  try {
    response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeoutSignal(PAYMENT_LOOKUP_TIMEOUT_MS)
    });
  } catch (_) {
    throw Object.assign(new Error('No se pudo consultar el pago en Mercado Pago.'), { code: 'MP_PAYMENT_LOOKUP_FAILED' });
  }

  if (!response.ok) {
    throw Object.assign(new Error('No se pudo consultar el pago en Mercado Pago.'), {
      code: 'MP_PAYMENT_LOOKUP_FAILED',
      providerStatus: response.status
    });
  }

  const data = await response.json().catch(() => null);
  if (!data || !data.id) {
    throw Object.assign(new Error('Mercado Pago devolvió un pago inválido.'), {
      code: 'MP_PAYMENT_LOOKUP_FAILED',
      providerStatus: response.status
    });
  }
  return data;
}

async function getPreference(preferenceId) {
  const token = mercadoPagoToken();
  const id = String(preferenceId || '').trim();
  if (!id) return null;

  let response;
  try {
    response = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeoutSignal(PREFERENCE_LOOKUP_TIMEOUT_MS)
    });
  } catch (_) {
    throw Object.assign(new Error('No se pudo verificar la preferencia de Mercado Pago.'), { code: 'MP_PREFERENCE_SEARCH_FAILED' });
  }

  if (!response.ok) {
    throw Object.assign(new Error('No se pudo verificar la preferencia de Mercado Pago.'), {
      code: 'MP_PREFERENCE_SEARCH_FAILED',
      providerStatus: response.status
    });
  }
  return response.json().catch(() => null);
}

async function findPreferenceByExternalReference(externalReference) {
  const token = mercadoPagoToken();
  const reference = String(externalReference || '').trim();
  if (!reference) return null;
  const url = new URL('https://api.mercadopago.com/checkout/preferences/search');
  url.searchParams.set('external_reference', reference);
  url.searchParams.set('limit', '10');

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeoutSignal(PREFERENCE_LOOKUP_TIMEOUT_MS)
    });
  } catch (_) {
    throw Object.assign(new Error('No se pudo buscar la preferencia en Mercado Pago.'), { code: 'MP_PREFERENCE_SEARCH_FAILED' });
  }

  if (!response.ok) {
    throw Object.assign(new Error('No se pudo buscar la preferencia en Mercado Pago.'), {
      code: 'MP_PREFERENCE_SEARCH_FAILED',
      providerStatus: response.status
    });
  }

  const data = await response.json().catch(() => ({}));
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const candidate = elements.find(item => String(item?.external_reference || '') === reference) || elements[0];
  if (!candidate?.id) return null;

  const detail = await getPreference(candidate.id);
  if (!detail?.id || !detail?.init_point) return null;
  if (detail.external_reference && String(detail.external_reference) !== reference) return null;
  return { id: String(detail.id), init_point: String(detail.init_point) };
}

async function createPreference(preference) {
  const token = mercadoPagoToken();
  let response;
  try {
    response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(preference),
      signal: timeoutSignal(PREFERENCE_CREATE_TIMEOUT_MS)
    });
  } catch (_) {
    throw Object.assign(new Error('No se pudo confirmar la creación del pago.'), { code: 'MP_PREFERENCE_CREATE_AMBIGUOUS' });
  }

  const data = await response.json().catch(() => ({}));
  if (response.ok && data?.id && data?.init_point) {
    return { id: String(data.id), init_point: String(data.init_point), recovered: false };
  }

  const ambiguous = response.status >= 500 || [408, 409, 423, 429].includes(response.status) || response.ok;
  throw Object.assign(new Error(ambiguous ? 'No se pudo confirmar la creación del pago.' : 'Mercado Pago rechazó la creación del pago.'), {
    code: ambiguous ? 'MP_PREFERENCE_CREATE_AMBIGUOUS' : 'MP_PREFERENCE_CREATE_REJECTED',
    providerStatus: response.status
  });
}

async function createPreferenceWithReconciliation(preference, externalReference) {
  try {
    return await createPreference(preference);
  } catch (error) {
    if (error?.code !== 'MP_PREFERENCE_CREATE_AMBIGUOUS') throw error;

    let lastLookupError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt) await delay(350);
      try {
        const recovered = await findPreferenceByExternalReference(externalReference);
        if (recovered) return { ...recovered, recovered: true };
      } catch (lookupError) {
        lastLookupError = lookupError;
      }
    }

    throw Object.assign(new Error('Mercado Pago quedó en un estado pendiente de verificación.'), {
      code: 'MP_PREFERENCE_UNCERTAIN',
      providerStatus: error?.providerStatus || lastLookupError?.providerStatus
    });
  }
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
      body: JSON.stringify({ expires: true, expiration_date_to: new Date(now).toISOString() }),
      signal: timeoutSignal(PREFERENCE_LOOKUP_TIMEOUT_MS)
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
  PREFERENCE_CREATE_TIMEOUT_MS,
  PREFERENCE_LOOKUP_TIMEOUT_MS,
  PAYMENT_LOOKUP_TIMEOUT_MS,
  NON_RESERVATION_PAYMENT_STATUSES,
  paymentsRequireReservation,
  preferenceWindow,
  findPaymentsByExternalReference,
  getPayment,
  findPreferenceByExternalReference,
  createPreference,
  createPreferenceWithReconciliation,
  expirePreference
};
