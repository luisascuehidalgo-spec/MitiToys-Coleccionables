(async()=>{
  try{
    const r=await fetch('/api/productos?cb='+Date.now(),{cache:'no-store'});
    if(!r.ok)return;
    const {products=[]}=await r.json();
    const grid=document.querySelector('#catalogo .grid');
    if(!grid)return;
    const existing=new Set([...grid.querySelectorAll('.badge')].map(x=>x.textContent.replace(/^COD\s*/i,'').trim()));
    const fresh=products.filter(p=>!existing.has(String(p.id)));
    if(!fresh.length)return;
    const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));
    const esc=s=>String(s??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
    const logo='https://raw.githubusercontent.com/luisascuehidalgo-spec/imagenes/main/WhatsApp%20Image%202026-09-01%20at%208.31.48%20PM.jpeg';
    fresh.forEach(p=>{
      const imgs=Array.isArray(p.images)?p.images:[];
      const first=imgs[0]||'';
      if(!first)return;
      const thumbs=imgs.map((u,i)=>`<div class="thumbwrap ${i===0?'active':''}" onclick="this.closest('.gallery').querySelector('.mainimg').src=this.querySelector('.thumb').src;this.parentElement.querySelectorAll('.thumbwrap').forEach(x=>x.classList.remove('active'));this.classList.add('active')"><img class="thumb" src="${esc(u)}" alt="${esc(p.title)} foto ${i+1}"><img class="thumbwm" src="${logo}" alt=""></div>`).join('');
      const card=document.createElement('article');
      card.className='card';
      card.innerHTML=`<div class="gallery"><div class="main-photo"><span class="badge">COD ${esc(p.id)}</span><img class="mainimg" src="${esc(first)}" alt="${esc(p.title)}"><img class="watermark" src="${logo}" alt="Logo Mititoys coleccionables"></div><div class="thumbs">${thumbs}</div></div><div class="body"><h3>${esc(p.title)}</h3><p class="desc">${esc(p.description||'Figura coleccionable de anime.')}</p><div class="specs"><span>⭐ Coleccionable</span><span>📦 Producto Mititoys</span></div><div class="price">${money(p.price)}</div><button class="paybtn cart-add" onclick="agregarAlCarrito('${esc(p.id)}',this)">🛒 AGREGAR AL CARRITO</button><button class="paybtn" onclick="pagar('${esc(p.id)}',this)">💳 PAGAR CON MERCADO PAGO</button><a class="buy" href="https://wa.me/541133466187?text=${encodeURIComponent('Hola, quiero consultar por la figura '+p.title+' COD '+p.id)}">💬 CONSULTAR POR WHATSAPP</a></div>`;
      grid.appendChild(card);
    });
  }catch(e){console.error('catalogo dinamico:',e)}
})();
