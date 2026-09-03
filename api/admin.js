const { getDb } = require('../lib/db');
const { verify } = require('./admin-auth');
const VALID = new Set(['pending','approved','processing','shipped','delivered','cancelled','refunded']);

module.exports = async (req,res)=>{
  if(!verify(req)) return res.status(401).json({error:'No autorizado.'});
  const sql=getDb();
  try{
    if(req.method==='GET'){
      const orders=await sql`SELECT o.id,o.order_number,o.product_id,o.product_title,o.quantity,o.unit_price,o.total_amount,o.currency,o.status,o.payment_id,o.payment_status,o.payment_status_detail,o.shipping_status,o.shipping_recipient,o.shipping_address,o.shipping_city,o.shipping_postal_code,o.shipping_phone,o.shipping_notes,o.shipping_carrier,o.tracking_number,o.created_at,o.updated_at,c.id AS customer_id,c.name AS customer_name,c.email AS customer_email,c.phone AS customer_phone,c.address AS customer_address,c.city AS customer_city,c.postal_code AS customer_postal_code FROM orders o LEFT JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 500`;
      const customers=await sql`SELECT c.id,c.name,c.email,c.phone,c.city,c.created_at,COUNT(o.id)::int AS orders_count,COALESCE(SUM(CASE WHEN o.payment_status='approved' THEN o.total_amount ELSE 0 END),0)::numeric AS total_spent FROM customers c LEFT JOIN orders o ON o.customer_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`;
      const products=await sql`SELECT id,title,price,stock_quantity,stock_managed,active,created_at,updated_at FROM products ORDER BY active DESC,title ASC`;
      return res.status(200).json({orders,customers,products});
    }
    if(req.method==='PATCH'){
      const id=Number(req.body?.id);
      const status=String(req.body?.status||'');
      const tracking=req.body?.tracking_number==null?null:String(req.body.tracking_number).trim().slice(0,120);
      const carrier=req.body?.shipping_carrier==null?null:String(req.body.shipping_carrier).trim().slice(0,80);
      const recipient=req.body?.shipping_recipient==null?null:String(req.body.shipping_recipient).trim().slice(0,160);
      const address=req.body?.shipping_address==null?null:String(req.body.shipping_address).trim().slice(0,220);
      const city=req.body?.shipping_city==null?null:String(req.body.shipping_city).trim().slice(0,100);
      const postal=req.body?.shipping_postal_code==null?null:String(req.body.shipping_postal_code).trim().slice(0,20);
      const phone=req.body?.shipping_phone==null?null:String(req.body.shipping_phone).trim().slice(0,50);
      const notes=req.body?.shipping_notes==null?null:String(req.body.shipping_notes).trim().slice(0,1000);
      if(!Number.isInteger(id)||id<1||!VALID.has(status)) return res.status(400).json({error:'Datos de pedido inválidos.'});
      const before=await sql`SELECT status FROM orders WHERE id=${id}`;
      if(!before.length) return res.status(404).json({error:'Pedido no encontrado.'});
      const shippingStatus=status==='shipped'?'shipped':status==='delivered'?'delivered':status==='processing'?'preparing':'not_shipped';
      const rows=await sql`UPDATE orders SET status=${status},shipping_status=${shippingStatus},shipping_recipient=${recipient},shipping_address=${address},shipping_city=${city},shipping_postal_code=${postal},shipping_phone=${phone},shipping_notes=${notes},shipping_carrier=${carrier},tracking_number=${tracking} WHERE id=${id} RETURNING *`;
      if(before[0].status!==status) await sql`INSERT INTO order_events(order_id,event_type,old_status,new_status,payload) VALUES(${id},'admin.status_changed',${before[0].status},${status},${JSON.stringify({tracking_number:tracking,shipping_carrier:carrier})})`;
      return res.status(200).json({order:rows[0]});
    }
    if(req.method==='PUT'){
      const id=String(req.body?.id||'').trim();
      const stock=Number(req.body?.stock_quantity);
      const managed=Boolean(req.body?.stock_managed);
      const active=Boolean(req.body?.active);
      const price=Number(req.body?.price);
      if(!id||!Number.isInteger(stock)||stock<0||!Number.isFinite(price)||price<0) return res.status(400).json({error:'Datos de producto inválidos.'});
      const current=await sql`SELECT stock_quantity FROM products WHERE id=${id}`;
      if(!current.length) return res.status(404).json({error:'Producto no encontrado.'});
      const delta=stock-Number(current[0].stock_quantity);
      const rows=await sql`UPDATE products SET stock_quantity=${stock},stock_managed=${managed},active=${active},price=${price},updated_at=NOW() WHERE id=${id} RETURNING *`;
      if(delta!==0) await sql`INSERT INTO inventory_movements(product_id,movement_type,quantity,reason) VALUES(${id},'adjustment',${delta},'Ajuste desde panel de administración')`;
      return res.status(200).json({product:rows[0]});
    }
    return res.status(405).json({error:'Método no permitido'});
  }catch(error){console.error('admin error:',error);return res.status(500).json({error:'Error interno del panel.'});}
};
