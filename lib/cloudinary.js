const { createHash, randomUUID } = require('node:crypto');

function configuration() {
  const names = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  if (names.some(name => !process.env[name]?.trim())) {
    throw Object.assign(new Error('Falta configurar el servicio de imágenes.'), { status: 503 });
  }
  return names.map(name => process.env[name].trim());
}

async function uploadImage(buffer, mime) {
  const [cloud, key, secret] = configuration();
  const publicId = `mititoys/products/${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash('sha1')
    .update(`overwrite=false&public_id=${publicId}&timestamp=${timestamp}${secret}`).digest('hex');
  const form = new FormData();
  form.set('file', new Blob([buffer], { type: mime }), 'image');
  form.set('api_key', key);
  form.set('public_id', publicId);
  form.set('overwrite', 'false');
  form.set('timestamp', String(timestamp));
  form.set('signature', signature);
  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(25000)
    });
    const result = await response.json();
    if (!response.ok || result.resource_type !== 'image' || !['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(String(result.format || '').toLowerCase())) throw new Error();
    const url = new URL(result.secure_url);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || !url.pathname.startsWith(`/${cloud}/image/upload/`)) throw new Error();
    return url.href;
  } catch {
    throw Object.assign(new Error('No se pudo subir la foto. Intentá nuevamente en unos momentos.'), { status: 502 });
  }
}

module.exports = { configuration, uploadImage };
