const { getDb } = require('../lib/db');
const { verify } = require('./admin-auth');

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function parseImages(value) {
  let list = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value); } catch { list = value.split(/\r?\n|,/); }
  }
  if (!Array.isArray(list)) list = [];
  return [...new Set(list.map(x => clean(x, 1000)).filter(x => /^https?:\/\//i.test(x)))].slice(0, 8);
}

function logistics(body) {
  const values = {
    weight_kg: Number(body?.weight_kg),
    package_length_cm: Number(body?.package_length_cm),
    package_width_cm: Number(body?.package_width_cm),
    package_height_cm: Number(body?.package_height_cm)
  };
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value <= 0) values[key] = null;
  }
  return values;
}

module.exports = async (req, res) => {
  if (!verify(req)) return res.status(401).json({ error: 'No autorizado.' });
  const sql = getDb();
  try {
    if (req.method === 'POST') {
      const id = clean(req.body?.id, 50);
      const title = clean(req.body?.title, 180);
      const description = clean(req.body?.description, 6000);
      const price = Number(req.body?.price);
      const stock = Number(req.body?.stock_quantity ?? 0);
      const stockManaged = Boolean(req.body?.stock_managed);
      const active = req.body?.active !== false;
      const images = parseImages(req.body?.images);
      const shipping = logistics(req.body);
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !title || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({ error: 'Completá COD, título, precio y stock correctamente.' });
      }
      const exists = await sql`SELECT id FROM products WHERE id=${id}`;
      if (exists.length) return res.status(409).json({ error: 'Ese COD ya existe.' });
      const rows = await sql`INSERT INTO products(id,title,description,images,price,stock_quantity,stock_managed,active,weight_kg,package_length_cm,package_width_cm,package_height_cm,created_at,updated_at) VALUES(${id},${title},${description},${JSON.stringify(images)}::jsonb,${price},${stock},${stockManaged},${active},${shipping.weight_kg},${shipping.package_length_cm},${shipping.package_width_cm},${shipping.package_height_cm},NOW(),NOW()) RETURNING *`;
      if (stock !== 0) await sql`INSERT INTO inventory_movements(product_id,movement_type,quantity,reason) VALUES(${id},'adjustment',${stock},'Stock inicial desde panel de administración')`;
      return res.status(201).json({ product: rows[0] });
    }
    if (req.method === 'PUT') {
      const id = clean(req.body?.id, 50);
      const stock = Number(req.body?.stock_quantity);
      const price = Number(req.body?.price);
      const managed = Boolean(req.body?.stock_managed);
      const active = Boolean(req.body?.active);
      const title = clean(req.body?.title, 180);
      const description = clean(req.body?.description, 6000);
      const images = parseImages(req.body?.images);
      const shipping = logistics(req.body);
      if (!id || !title || !Number.isInteger(stock) || stock < 0 || !Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Datos de producto inválidos.' });
      const current = await sql`SELECT stock_quantity FROM products WHERE id=${id}`;
      if (!current.length) return res.status(404).json({ error: 'Producto no encontrado.' });
      const delta = stock - Number(current[0].stock_quantity);
      const rows = await sql`UPDATE products SET title=${title},description=${description},images=${JSON.stringify(images)}::jsonb,stock_quantity=${stock},stock_managed=${managed},active=${active},price=${price},weight_kg=${shipping.weight_kg},package_length_cm=${shipping.package_length_cm},package_width_cm=${shipping.package_width_cm},package_height_cm=${shipping.package_height_cm},updated_at=NOW() WHERE id=${id} RETURNING *`;
      if (delta !== 0) await sql`INSERT INTO inventory_movements(product_id,movement_type,quantity,reason) VALUES(${id},'adjustment',${delta},'Ajuste desde panel de administración')`;
      return res.status(200).json({ product: rows[0] });
    }
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (error) {
    console.error('admin product error:', error);
    return res.status(500).json({ error: 'No se pudo guardar el producto.' });
  }
};
