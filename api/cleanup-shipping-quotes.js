const { getDb } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  try {
    const sql = getDb();
    const rows = await sql`
      WITH deleted_quotes AS (
        DELETE FROM shipping_quotes
        WHERE used_at IS NULL
          AND order_id IS NULL
          AND expires_at < NOW() - INTERVAL '24 hours'
        RETURNING id
      ), deleted_rate_limits AS (
        DELETE FROM admin_login_attempts
        WHERE updated_at < NOW() - INTERVAL '24 hours'
          AND (locked_until IS NULL OR locked_until < NOW())
        RETURNING ip_hash
      )
      SELECT
        (SELECT COUNT(*)::int FROM deleted_quotes) AS deleted_quotes,
        (SELECT COUNT(*)::int FROM deleted_rate_limits) AS deleted_rate_limits
    `;
    return res.status(200).json({
      ok: true,
      deleted_quotes: Number(rows[0]?.deleted_quotes || 0),
      deleted_rate_limits: Number(rows[0]?.deleted_rate_limits || 0)
    });
  } catch (error) {
    console.error('maintenance cleanup failed:', 'code=' + String(error?.code || error?.name || 'MAINTENANCE_CLEANUP_ERROR'));
    return res.status(500).json({ error: 'No se pudo ejecutar la limpieza de mantenimiento.' });
  }
};
