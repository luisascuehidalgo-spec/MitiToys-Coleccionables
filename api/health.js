const { getDb } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const sql = getDb();
    await sql`SELECT 1 AS ok`;
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=30');
    return res.status(200).json({ ok: true, database: true });
  } catch (error) {
    console.error('health error:', 'code=' + String(error?.code || error?.name || 'HEALTH_CHECK_FAILED'));
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(500).json({ ok: false, database: false, error: 'Base de datos no configurada o no disponible.' });
  }
};
