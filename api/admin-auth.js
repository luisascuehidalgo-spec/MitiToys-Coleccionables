const crypto = require('crypto');

function sign(value) {
  return crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET || '').update(value).digest('hex');
}

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const password = String(req.body?.password || '');
    const configured = process.env.ADMIN_PASSWORD;
    if (!configured || password.length !== configured.length || !crypto.timingSafeEqual(Buffer.from(password), Buffer.from(configured))) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }
    const value = `admin:${Date.now()}`;
    const token = Buffer.from(`${value}.${sign(value)}`).toString('base64url');
    res.setHeader('Set-Cookie', `mititoys_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`);
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'mititoys_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'Método no permitido' });
};

module.exports.verify = function verify(req) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return false;
  const header = String(req.headers.cookie || '');
  const match = header.match(/(?:^|; )mititoys_admin=([^;]+)/);
  if (!match) return false;
  try {
    const decoded = Buffer.from(match[1], 'base64url').toString('utf8');
    const dot = decoded.lastIndexOf('.');
    if (dot < 1) return false;
    const value = decoded.slice(0, dot);
    const sig = decoded.slice(dot + 1);
    const expected = sign(value);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) && value.startsWith('admin:');
  } catch (_) { return false; }
};
