(()=>{
  const FALLBACK_3431={
    id:'3431',
    title:'🏴‍☠️ FIGURA LUFFY GEAR 5 – NIKA – ONE PIECE – 23 CM',
    description:'Figura coleccionable de Luffy Gear 5 / Nika de One Piece, 23 cm. Ideal para colección y exhibición.',
    price:120000,
    active:true,
    images:['/api/product-image?id=2','/api/product-image?id=3']
  };

  const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const logo='https://raw.githubusercontent.com/luisascuehidalgo-spec/imagenes/main/WhatsApp%20Image%202026-09-01%20at%208.31.48%20PM.jpeg';

  function enhanceStoreTrust(){
    const nav=document.querySelector('.links');
    if(nav&&!nav.querySelector('[data-track-link]')){
      const a=document.createElement('a');
      a.href='/seguimiento.html';
      a.dataset.trackLink='1';
      a.textContent='Seguir pedido';
      nav.appendChild(a);
    }

    if(!document.getElementById('mititoysTrustStyle')){
      const style=document.createElement('style');
      style.id='mititoysTrustStyle';
      style.textContent='.mt-support{max-width:1200px;margin:0 auto 55px;padding:0 22px}.mt-supportbox{background:linear-gradient(135deg,#111,#17100b);border:1px solid #30271d;border-radius:18px;padding:28px}.mt-supportbox h2{margin:0 0 8px;font-size:28px;color:#ffd21c}.mt-supportbox>p{margin:0 0 20px;color:#aaa}.mt-supportgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.mt-supportcard{display:block;background:#171717;border:1px solid #2a2a2a;border-radius:12px;padding:18px;transition:.2s}.mt-supportcard:hover{transform:translateY(-2px);border-color:#555}.mt-supportcard b{display:block;margin-bottom:7px;font-size:16px}.mt-supportcard span{color:#aaa;font-size:13px;line-height:1.5}.mt-footerlinks{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;margin-top:12px}.mt-footerlinks a{color:#bbb;font-size:13px}@media(max-width:760px){.mt-supportgrid{grid-template-columns:1fr}}';
      document.head.appendChild(style);
    }

    const footer=document.querySelector('footer');
    if(footer&&!document.getElementById('mititoysSupport')){
      const section=document.createElement('section');
      section.className='mt-support';
      section.id='mititoysSupport';
      section.innerHTML='<div class="mt-supportbox"><h2>Comprá con tranquilidad</h2><p>Te acompañamos antes, durante y después de tu compra.</p><div class="mt-supportgrid"><a class="mt-supportcard" href="/seguimiento.html"><b>📦 Seguí tu pedido</b><span>Consultá de forma segura el estado del pago y del envío.</span></a><a class="mt-supportcard" href="/preguntas.html"><b>❓ Preguntas frecuentes</b><span>Encontrá respuestas rápidas sobre compras, pagos y entregas.</span></a><a class="mt-supportcard" href="/politicas.html"><b>🛡️ Políticas de compra</b><span>Información clara para comprar con mayor confianza.</span></a></div></div>';
      footer.parentNode.insertBefore(section,footer);
      footer.innerHTML='© 2026 Mititoys coleccionables · Figuras de anime para coleccionistas<div class="mt-footerlinks"><a href="/seguimiento.html">Seguimiento</a><a href="/preguntas.html">Preguntas frecuentes</a><a href="/politicas.html">Políticas</a><a target="_blank" rel="noopener" href="https://wa.me/541133466187">WhatsApp</a></div>';
    }
  }

  function enhanceDetailLinks(grid){
    grid.querySelectorAll('.card').forEach(card=>{
      if(card.querySelector('.detail-link')) return;
      const badge=card.querySelector('.badge');
      if(!badge) return;
      const id=badge.textContent.replace(/^COD\s*/i,'').trim();
      if(!id) return;
      const link=document.createElement('a');
      link.className='buy detail-link';
      link.href=`/producto.html?id=${encodeURIComponent(id)}`;
      link.textContent='👁 VER DETALLE DEL PRODUCTO';
      const body=card.querySelector('.body');
      const whatsapp=body?.querySelector('a.buy:not(.detail-link)');
      if(whatsapp) body.insertBefore(link,whatsapp);
      else body?.appendChild(link);
    });
  }

  function renderProduct(grid,p){
    if(!p || p.active===false) return;
    const existing=[...grid.querySelectorAll('.badge')].some(x=>x.textContent.replace(/^COD\s*/i,'').trim()===String(p.id));
    if(existing) return;

    const imgs=Array.isArray(p.images)?p.images.filter(Boolean):[];
    if(!imgs.length) return;

    const thumbs=imgs.map((u,i)=>`<div class="thumbwrap ${i===0?'active':''}" data-index="${i}"><img class="thumb" src="${esc(u)}" alt="${esc(p.title)} foto ${i+1}"><img class="thumbwm" src="${logo}" alt=""></div>`).join('');
    const card=document.createElement('article');
    card.className='card dynamic-product';
    card.dataset.productId=String(p.id);
    card.innerHTML=`<div class="gallery"><div class="main-photo"><span class="badge">COD ${esc(p.id)}</span><img class="mainimg" src="${esc(imgs[0])}" alt="${esc(p.title)}"><img class="watermark" src="${logo}" alt="Logo Mititoys coleccionables"></div><div class="thumbs">${thumbs}</div></div><div class="body"><h3>${esc(p.title)}</h3><p class="desc">${esc(p.description||'Figura coleccionable de anime.')}</p><div class="specs"><span>⭐ Coleccionable</span><span>📦 Producto Mititoys</span></div><div class="price">${money(p.price)} ARS</div><button class="paybtn cart-add" type="button">🛒 AGREGAR AL CARRITO</button><button class="paybtn pay-now" type="button">💳 PAGAR CON MERCADO PAGO</button><a class="buy detail-link" href="/producto.html?id=${encodeURIComponent(p.id)}">👁 VER DETALLE DEL PRODUCTO</a><a class="buy" target="_blank" rel="noopener" href="https://wa.me/541133466187?text=${encodeURIComponent('Hola, quiero consultar por la figura '+p.title+' COD '+p.id)}">💬 CONSULTAR POR WHATSAPP</a></div>`;

    card.querySelectorAll('.thumbwrap').forEach(t=>{
      t.addEventListener('click',()=>{
        const main=card.querySelector('.mainimg');
        const img=t.querySelector('.thumb');
        if(main&&img) main.src=img.src;
        card.querySelectorAll('.thumbwrap').forEach(x=>x.classList.remove('active'));
        t.classList.add('active');
      });
    });

    const add=card.querySelector('.cart-add');
    if(add) add.addEventListener('click',()=>{
      if(window.agregarAlCarrito) window.agregarAlCarrito(String(p.id),add);
      else {
        try{
          const key='mititoys_cart';
          const cart=JSON.parse(localStorage.getItem(key)||'[]');
          const found=cart.find(x=>String(x.id)===String(p.id));
          if(found) found.qty=(Number(found.qty)||0)+1; else cart.push({id:String(p.id),qty:1});
          localStorage.setItem(key,JSON.stringify(cart));
          add.textContent='✓ AGREGADO AL CARRITO';
        }catch(_){ }
      }
    });

    const pay=card.querySelector('.pay-now');
    if(pay) pay.addEventListener('click',()=>{
      if(window.pagar) window.pagar(String(p.id),pay);
      else window.location.href='/checkout.html?cart=1';
    });

    grid.appendChild(card);
  }

  async function load(){
    enhanceStoreTrust();
    const grid=document.querySelector('#catalogo .grid');
    if(!grid) return;

    enhanceDetailLinks(grid);

    let products=[];
    try{
      const r=await fetch('/api/productos?cb='+Date.now(),{cache:'no-store',headers:{'Accept':'application/json'}});
      if(r.ok){
        const data=await r.json();
        products=Array.isArray(data.products)?data.products:[];
      }
    }catch(e){
      console.error('catalogo-dinamico api:',e);
    }

    const map=new Map(products.map(p=>[String(p.id),p]));
    if(!map.has('3431')) map.set('3431',FALLBACK_3431);
    for(const p of map.values()) renderProduct(grid,p);
    enhanceDetailLinks(grid);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',load,{once:true});
  else load();
})();
