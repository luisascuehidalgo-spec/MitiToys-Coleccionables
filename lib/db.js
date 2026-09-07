const { neon } = require('@neondatabase/serverless');

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta configurar DATABASE_URL.');
  return neon(url);
}

module.exports = { getDb };
