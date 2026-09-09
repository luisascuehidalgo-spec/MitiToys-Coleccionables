// Temporary production diagnostic for Vercel Cron authentication.
// Never logs or returns secret/header values.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });

  const secret = process.env.CRON_SECRET;
  const authorized = Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
  const reason = !secret
    ? 'cron_secret_missing'
    : (authorized ? 'authorized' : 'authorization_mismatch');

  console.warn('cron auth diagnostic:', 'reason=' + reason);
  return res.status(authorized ? 200 : 401).json({ ok: authorized });
};
