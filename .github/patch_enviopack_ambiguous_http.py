from pathlib import Path

p = Path('lib/shipping.js')
s = p.read_text()

old = """  if (!response.ok) {
    const providerMessage = String(data?.mensaje || data?.message || data?.error || '').slice(0, 350);
"""
new = """  if (!response.ok) {
    if (options.uncertainOnTransportError && (response.status === 408 || response.status >= 500)) {
      throw Object.assign(new Error('No se pudo confirmar si Envíopack completó la operación.'), { code: 'SHIPPING_PROVIDER_UNCERTAIN', providerStatus: response.status });
    }
    const providerMessage = String(data?.mensaje || data?.message || data?.error || '').slice(0, 350);
"""
if old not in s:
    raise SystemExit('provider HTTP error classification target missing')
s = s.replace(old, new, 1)

old = """  if (!data?.id) throw Object.assign(new Error('Envíopack no devolvió el identificador del envío.'), { code: 'SHIPPING_PROVIDER_ERROR' });
  return data;
}

async function getShipment(shipmentId) {
"""
new = """  if (!data?.id) throw Object.assign(new Error('No se pudo confirmar el identificador del envío creado en Envíopack.'), { code: 'SHIPPING_PROVIDER_UNCERTAIN' });
  return data;
}

async function getShipment(shipmentId) {
"""
if old not in s:
    raise SystemExit('missing shipment id classification target missing')
s = s.replace(old, new, 1)

p.write_text(s)
