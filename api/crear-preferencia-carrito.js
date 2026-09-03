const { getDb } = require('../lib/db');
const clean=(v,max=200)=>String(v||'').trim().slice(0,max);
const PRODUCTOS={
  "3377":{id:"3377",title:"Figura Luffy Gear 5 – Nika – One Piece – 31 cm",description:"Figura coleccionable de Monkey D. Luffy Gear 5 / Nika, One Piece. 31 cm aprox., PVC, incluye figura + caja.",price:150000,picture_url:"https://raw.githubusercontent.com/luisascuehidalgo-spec/imagenes/main/20241123034449_1.jpg"},
  "3375":{id:"3375",title:"Figura One Piece Kaido Dragón 30 Cm PVC Coleccionable Anime",description:"Estatua coleccionable de Kaido con dragón azul. 30 cm aprox. de altura, 37 cm aprox. de ancho, PVC.",price:300000,picture_url:"https://raw.githubusercontent.com/luisascuehidalgo-spec/COD-3375/main/D_NQ_NP_2X_758000-MLA115602430906_092026-F.webp"}
};
module.exports=async(req,res)=>{
  if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
  if(!process.env.MERCADOPAGO_ACCESS_TOKEN)return res.status(500).json({error:'Falta configurar Mercado Pago.'});
  let sql=null,orderId=null,reserved=[];
  try{
    const body=req.body||{}; const raw=Array.isArray(body.items)?body.items:[];
    if(!raw.length)return res.status(400).json({error:'El carrito está vacío.'});
    const map=new Map(); for(const x of raw){const id=String(x?.id||'').trim();const qty=Math.max(1,Math.min(20,Math.floor(Number(x?.qty)||1)));if(id)map.set(id,(map.get(id)||0)+qty);}
    const ids=[...map.keys()].slice(0,20); if(!ids.length)return res.status(400).json({error:'El carrito está vacío.'});
    const c=body.customer||{}; const email=clean(c.email,160).toLowerCase();
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Ingresá un email válido para continuar.'});
    const origin=req.headers.origin||'https://otaku-collectibles.vercel.app'; sql=getDb(); const items=[];
    for(const id of ids){
      const rows=await sql`SELECT id,title,description,price,stock_quantity,stock_managed,active,images FROM products WHERE id=${id} LIMIT 1`;
      let p=rows[0]||PRODUCTOS[id]; if(!p)return res.status(400).json({error:`Producto no válido: ${id}.`});
      if(p.active===false)return res.status(409).json({error:`El producto ${p.title} ya no está disponible.`});
      const qty=map.get(id); const price=Number(p.price); if(!Number.isFinite(price)||price<0)throw new Error('Precio de producto inválido.');
      let pictureUrl=PRODUCTOS[id]?.picture_url||''; const legacy=Array.isArray(p.images)?p.images:[]; if(legacy[0])pictureUrl=String(legacy[0]);
      const uploaded=await sql`SELECT id FROM product_images WHERE product_id=${id} ORDER BY sort_order,id LIMIT 1`; if(uploaded.length)pictureUrl=`${origin}/api/product-image?id=${uploaded[0].id}`;
      items.push({id,title:String(p.title),description:clean(p.description||PRODUCTOS[id]?.description||'Figura coleccionable de anime.',600),price,qty,stockManaged:Boolean(p.stock_managed),pictureUrl});
    }
    const total=items.reduce((s,x)=>s+x.price*x.qty,0); const units=items.reduce((s,x)=>s+x.qty,0); const summary=items.length===1?items[0].title:`${items.length} productos: ${items.map(x=>`${x.title} x${x.qty}`).join(' · ')}`;
    const customerRows=await sql`INSERT INTO customers(name,email,phone,address,city,postal_code) VALUES(${clean(c.name,120)||'Cliente'},${email},${clean(c.phone,50)||null},${clean(c.address,200)||null},${clean(c.city,100)||null},${clean(c.postal_code,20)||null}) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,phone=COALESCE(EXCLUDED.phone,customers.phone),address=COALESCE(EXCLUDED.address,customers.address),city=COALESCE(EXCLUDED.city,customers.city),postal_code=COALESCE(EXCLUDED.postal_code,customers.postal_code) RETURNING id`;
    const customerId=customerRows[0].id; const first=items[0]; const tempRef=`MITITOYS-PENDING-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const orderRows=await sql`INSERT INTO orders(order_number,customer_id,product_id,product_title,quantity,unit_price,total_amount,external_reference,shipping_recipient,shipping_address,shipping_city,shipping_postal_code,shipping_phone,shipping_notes) VALUES('MT-'||TO_CHAR(NOW(),'YYYYMMDDHH24MISSMS')||'-'||SUBSTRING(MD5(RANDOM()::text),1,6),${customerId},${first.id},${summary},${units},${first.price},${total},${tempRef},${clean(c.name,160)||'Cliente'},${clean(c.address,220)||null},${clean(c.city,100)||null},${clean(c.postal_code,20)||null},${clean(c.phone,50)||null},${clean(c.notes,1000)||null}) RETURNING id,order_number`;
    orderId=orderRows[0].id; const orderNumber=orderRows[0].order_number; const externalReference=`MITITOYS-ORDER-${orderId}`; await sql`UPDATE orders SET external_reference=${externalReference} WHERE id=${orderId}`;
    for(const item of items)await sql`INSERT INTO order_items(order_id,product_id,product_title,quantity,unit_price,total_amount) VALUES(${orderId},${item.id},${item.title},${item.qty},${item.price},${item.price*item.qty})`;
    for(const item of items){
      if(!item.stockManaged)continue;
      const r=await sql`UPDATE products SET stock_quantity=stock_quantity-${item.qty},updated_at=NOW() WHERE id=${item.id} AND stock_quantity>=${item.qty} RETURNING stock_quantity`;
      if(!r.length)throw new Error(`Sin stock disponible para ${item.title}.`);
      reserved.push(item); await sql`INSERT INTO inventory_movements(product_id,order_id,movement_type,quantity,reason) VALUES(${item.id},${orderId},'reserve',${-item.qty},'Reserva automática al iniciar una compra')`;
    }
    const preference={items:items.map(x=>({id:x.id,title:x.title,description:x.description,picture_url:x.pictureUrl,quantity:x.qty,currency_id:'ARS',unit_price:x.price})),payer:{name:clean(c.name,120),email},external_reference:externalReference,back_urls:{success:`${origin}/pedido.html?pedido=${encodeURIComponent(orderNumber)}&pago=exitoso`,pending:`${origin}/pedido.html?pedido=${encodeURIComponent(orderNumber)}&pago=pendiente`,failure:`${origin}/pedido.html?pedido=${encodeURIComponent(orderNumber)}&pago=fallido`},auto_return:'approved',statement_descriptor:'MITITOYS'};
    const mp=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`},body:JSON.stringify(preference)}); const data=await mp.json(); if(!mp.ok)throw new Error('Mercado Pago rechazó la creación del pago.');
    await sql`UPDATE orders SET preference_id=${data.id} WHERE id=${orderId}`; await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${orderId},'order.created','pending',${JSON.stringify({preference_id:data.id,multi_product:true,items:items.map(x=>({product_id:x.id,quantity:x.qty,unit_price:x.price})),stock_reserved:reserved.map(x=>({product_id:x.id,quantity:x.qty}))})})`;
    return res.status(200).json({init_point:data.init_point,preference_id:data.id,order_number:orderNumber});
  }catch(e){
    console.error('crear-preferencia-carrito error:',e);
    if(sql&&orderId){try{await sql`UPDATE orders SET status='cancelled',updated_at=NOW() WHERE id=${orderId}`;}catch(_){} for(const item of reserved){try{await sql`UPDATE products SET stock_quantity=stock_quantity+${item.qty},updated_at=NOW() WHERE id=${item.id}`;await sql`INSERT INTO inventory_movements(product_id,order_id,movement_type,quantity,reason) VALUES(${item.id},${orderId},'release',${item.qty},'Liberación por error al crear el pago')`;}catch(_){}}}
    if(String(e?.message||'').startsWith('Sin stock disponible'))return res.status(409).json({error:e.message});
    return res.status(500).json({error:'No se pudo crear el pago.'});
  }
};
