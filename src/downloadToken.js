const crypto = require('crypto');

function tokenSecret() {
  return process.env.DOWNLOAD_SECRET || 'dev-download-secret-change-me';
}

async function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createDownloadToken(taskId, userId, ttlSeconds = 600) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const payload = `${taskId}.${userId}.${expiresAt.getTime()}`;
  const sig = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  return { token: `${Buffer.from(payload).toString('base64url')}.${sig}`, expiresAt, ttlSeconds };
}

function verifyDownloadToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [encodedPayload, sig] = token.split('.');
  if (!encodedPayload || !sig) return null;
  let payload;
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [taskId, userId, expiresAtText] = payload.split('.');
  const expiresAt = Number(expiresAtText);
  if (!taskId || !userId || !expiresAt || expiresAt < Date.now()) return null;
  return { taskId, userId, expiresAt: new Date(expiresAt) };
}

module.exports = { createDownloadToken, verifyDownloadToken, hashToken };
