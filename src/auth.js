const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  const fixed = Buffer.alloc(Math.max(ab.length, bb.length));
  bb.copy(fixed);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, fixed);
}

async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return timingSafeEqual(actual, expected);
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signSession(payload, secret) {
  const body = base64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!timingSafeEqual(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function createSession(user) {
  const secret = process.env.SESSION_SECRET || process.env.DOWNLOAD_SECRET || 'dev-download-secret-change-me';
  const ttlMs = Number(process.env.SESSION_TTL_SECONDS || 8 * 3600) * 1000;
  const token = signSession({ sub: user.id, username: user.username, exp: Date.now() + ttlMs }, secret);
  return { token, expiresInSeconds: Math.floor(ttlMs / 1000) };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  // GET 预览页需要能在新标签页打开；仅在查询串中接受短期会话令牌，且不写缓存。
  const queryToken = req.method === 'GET' ? req.query.access_token : null;
  const token = bearer || queryToken;
  const secret = process.env.SESSION_SECRET || process.env.DOWNLOAD_SECRET || 'dev-download-secret-change-me';
  const user = token ? verifySession(token, secret) : null;
  if (!user) return res.status(401).json({ error: '需要重新登录' });
  req.user = user;
  next();
}

module.exports = { verifyPassword, createSession, requireAuth, verifySession };
