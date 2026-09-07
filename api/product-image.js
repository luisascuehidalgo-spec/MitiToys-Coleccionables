// Legacy compatibility endpoint. Product images were migrated out of Neon.
// Keep this route DB-free so stale browser URLs can never consume database transfer.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
  return res.status(410).end();
};
