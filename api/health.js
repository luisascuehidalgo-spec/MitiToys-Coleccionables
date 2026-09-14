const { getDb } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  try {
    const sql = getDb();
    await sql`SELECT 1 AS ok`;
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('health error:', 'code=' + String(error?.code || error?.name || 'HEALTH_CHECK_FAILED'));
    return res.status(500).json({ ok: false, error: 'Servicio temporalmente no disponible.' });
  }
};
