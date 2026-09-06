const { getDb } = require('../lib/db');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const logo = 'https://raw.githubusercontent.com/luisascuehidalgo-spec/imagenes/main/WhatsApp%20Image%202026-09-01%20at%208.31.48%20PM.jpeg';
const cta = 'Entrá ahora a mititoys.com y encontrá la figura que falta en tu colección.';
const priority = ['3375','3725','3436','3374','3999','3730','2264'];

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Método no permitido.');
  try {
    const sql = getDb();
    // Keep old uploaded photos and include new Cloudinary uploads from the admin.
    const rows = await sql`SELECT p.id,p.title,i.id AS image_id FROM products p JOIN product_images i ON i.product_id=p.id WHERE p.active=true ORDER BY p.id,i.sort_order,i.id`;
    const grouped = new Map();
    for (const row of rows) {
      const id = String(row.id);
      if (!grouped.has(id)) grouped.set(id, {id, title:row.title, images:[]});
      grouped.get(id).images.push('https://mititoys.com/api/product-image?id=' + encodeURIComponent(row.image_id));
    }
    const cloudProducts = await sql`SELECT id,title,images FROM products WHERE active=true AND jsonb_array_length(images)>0 ORDER BY id`;
    for (const product of cloudProducts) {
      const images = (product.images || []).filter(value => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' && url.pathname.includes('/mititoys/products/');
        } catch { return false; }
      });
      if (!images.length) continue;
      const id = String(product.id);
      if (!grouped.has(id)) grouped.set(id, { id, title: product.title, images: [] });
      grouped.get(id).images.push(...images);
    }
    const rank = id => priority.includes(id) ? priority.indexOf(id) : priority.length;
    const products = [...grouped.values()].sort((a,b) => rank(a.id)-rank(b.id) || a.title.localeCompare(b.title,'es'));
    if (!products.length) return res.status(503).send('El catálogo no está disponible en este momento.');
    const photo = (p,url,n) => `<img src="${esc(url)}" alt="${esc(p.title)} · foto ${n+1}" width="800" height="800" loading="eager">`;
    const mosaic = products.slice(0,6).map(p => `<figure>${photo(p,p.images[0],0)}<figcaption>${esc(p.title)}</figcaption></figure>`).join('');
    const gallery = products.map(p => `<article><header><span>MITITOYS · COLECCIONABLES</span><h2>${esc(p.title)}</h2></header><div class="photos">${p.images.map((url,n)=>photo(p,url,n)).join('')}</div></article>`).join('');
    return res.status(200).send(`<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MitiToys · Tu colección. Tu universo.</title><meta name="description" content="Figuras de anime para coleccionistas. ${cta}"><link rel="canonical" href="https://mititoys.com/anuncio"><meta name="theme-color" content="#070707"><meta property="og:title" content="MitiToys · Tu colección. Tu universo."><meta property="og:description" content="${cta}"><meta property="og:url" content="https://mititoys.com/anuncio"><meta property="og:type" content="website"><style>
    *{box-sizing:border-box}body{margin:0;background:#070707;color:#fff;font-family:Arial,Helvetica,sans-serif}main,.brand{max-width:1240px;margin:auto;padding:24px}a{color:inherit}.brand{display:flex;align-items:center;gap:20px;border-bottom:1px solid #242424;font-weight:900;color:#ffd21c}.brand img{width:140px;height:84px;object-fit:contain}.intro{padding:42px 0 28px}.eyebrow,article header span{font-size:14px;letter-spacing:.12em;color:#ffd21c;font-weight:800}h1{font-size:clamp(40px,6vw,76px);line-height:1;margin:18px 0;color:#ffd21c;text-transform:uppercase;letter-spacing:-.04em}.intro p{font-size:20px;line-height:1.5;color:#ddd}.mosaic{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:0;background:#121212;border:1px solid #242424;border-radius:12px;overflow:hidden}figure img{width:100%;height:280px;object-fit:contain;display:block;background:#111}figcaption{padding:14px;font-size:16px;line-height:1.4;font-weight:700}.divider{padding:64px 0 20px;font-size:clamp(28px,4vw,44px);color:#ffd21c}article{border-top:1px solid #333;padding:28px 0 36px}h2{font-size:clamp(23px,3vw,32px);line-height:1.25;margin:12px 0 24px}.photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.photos img{display:block;width:100%;height:360px;object-fit:contain;background:#121212;border-radius:10px}.outro{border-top:4px solid #ef2525;padding:48px 0 64px;max-width:900px}.outro p{font-size:clamp(26px,4vw,44px);line-height:1.2;font-weight:900}.button{display:inline-block;background:#ef2525;color:white;padding:18px 28px;border-radius:8px;text-decoration:none;font-weight:900;font-size:18px}.button:focus-visible{outline:3px solid #ffd21c;outline-offset:5px}@media(max-width:650px){main,.brand{padding:16px}.brand img{width:110px;height:65px}.mosaic,.photos{grid-template-columns:repeat(2,minmax(0,1fr))}figure img{height:190px}.photos img{height:230px}figcaption{font-size:14px;padding:10px}}
    </style></head><body><header class="brand"><img src="${logo}" alt="Logo MitiToys coleccionables"><span>MITITOYS COLECCIONABLES</span></header><main><section class="intro"><span class="eyebrow">FIGURAS DE ANIME · PARA COLECCIONISTAS</span><h1>Tu colección.<br>Tu universo.</h1><p>Personajes que te acompañan. Figuras que hacen tu colección única.</p></section><section class="mosaic" aria-label="Figuras del catálogo actual">${mosaic}</section><h2 class="divider">Encontrá tu próxima figura.</h2>${gallery}<footer class="outro"><span class="eyebrow">TU PRÓXIMA HISTORIA EMPIEZA ACÁ</span><p>${cta}</p><a class="button" href="https://mititoys.com">ENTRAR A MITITOYS.COM</a></footer></main></body></html>`);
  } catch (error) {
    console.error('anuncio catalog unavailable');
    return res.status(503).send('No se pudo cargar el catálogo actual. Intentá nuevamente en unos minutos.');
  }
};

