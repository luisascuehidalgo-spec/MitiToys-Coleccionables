const fs=require('fs');
const path=require('path');
module.exports=async(req,res)=>{
  if(req.method!=='GET')return res.status(405).end();
  try{
    let html=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
    const scripts='<script src="/carrito.js?v=1"></script><script src="/catalogo-dinamico.js?v=2"></script>';
    if(!html.includes('/carrito.js'))html=html.replace('</body>',scripts+'</body>');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(html);
  }catch(e){console.error('storefront error:',e);return res.status(500).send('No se pudo cargar la tienda.');}
};
