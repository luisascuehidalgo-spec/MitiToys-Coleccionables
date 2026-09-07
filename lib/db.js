const { neon } = require('@neondatabase/serverless');

// QA-only diagnostic: make Node print the call stack for deprecation warnings.
process.traceDeprecation = true;

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta configurar DATABASE_URL.');
  return neon(url);
}

module.exports = { getDb };
