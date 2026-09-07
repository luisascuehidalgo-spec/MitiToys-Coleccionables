function searchParams(req) {
  return new URL(req?.url || '/', 'http://localhost').searchParams;
}

module.exports = { searchParams };
