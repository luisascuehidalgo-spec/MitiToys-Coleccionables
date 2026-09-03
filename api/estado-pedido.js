const { getDb } = require('../lib/db');
module.exports = async (req,res)=>{
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  try{
    const number=String(req.query?.pedido||'').trim();
    if(!number) return res.status(400).json({error:'Falta el número de pedido.'});
    const sql=getDb();
    const rows=await sql`SELECT order_number,product_title,quantity,total_amount,currency,status,payment_status,payment_status_detail,shipping_status,shipping_recipient,shipping_carrier,tracking_number,created_at,updated_at FROM orders WHERE order_number=${number} LIMIT 1`;
    if(!rows.length) return res.status(404).json({error:'Pedido no encontrado.'});
    return res.status(200).json({order:rows[0]});
  }catch(error){console.error('estado-pedido error:',error);return res.status(500).json({error:'No se pudo consultar el pedido.'});}
};
