const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySession, createSession } = require('../src/auth');
const { createDownloadToken, verifyDownloadToken } = require('../src/downloadToken');

test('篡改或过期的会话 token 会被拒绝', () => {
  const secret = 'unit-test-secret';
  const { token } = createSession({ id: 'u1', username: 'admin' });
  const [body] = token.split('.');
  assert.equal(verifySession(`${body}.bad-signature`, secret), null);
  const expiredToken = (() => {
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', exp: 1 })).toString('base64url');
    const crypto = require('crypto');
    return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
  })();
  assert.equal(verifySession(expiredToken, secret), null);
});

test('下载 token 携带任务、用户和短期有效期，签名篡改无效', () => {
  process.env.DOWNLOAD_SECRET = 'download-secret-unit';
  const issued = createDownloadToken('task-1', 'user-1', 600);
  const verified = verifyDownloadToken(issued.token);
  assert.equal(verified.taskId, 'task-1');
  assert.equal(verified.userId, 'user-1');
  const tampered = issued.token.slice(0, -2) + (issued.token.endsWith('a') ? 'b' : 'a');
  assert.equal(verifyDownloadToken(tampered), null);
});
