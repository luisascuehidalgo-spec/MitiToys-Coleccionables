let dep0169TraceInstalled = false;
if (!dep0169TraceInstalled) {
  dep0169TraceInstalled = true;
  process.on('warning', warning => {
    if (warning?.code === 'DEP0169') console.warn('DEP0169 origin stack:', warning.stack);
  });
}

const { neon } = require('@neondatabase/serverless');

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta configurar DATABASE_URL.');
  return neon(url);
}

module.exports = { getDb };
