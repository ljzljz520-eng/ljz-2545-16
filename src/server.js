const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const pool = require('./db/pool');
const migrate = require('./db/migrate');
const { verifyPassword, createSession, requireAuth, verifySession } = require('./auth');
const { createDownloadToken, verifyDownloadToken, hashToken } = require('./downloadToken');
const {
  listRoutes,
  evaluateRoute,
  createTask,
  getTaskForUser,
  startWorker,
  fileDir
} = require('./tasks');
const { buildCardContent, measureContent, renderHtmlPreview, FIELD_SPECS, SUMMARY_SPECS, WALKING_MODES } = require('./layout');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/fonts', express.static(path.resolve(__dirname, '../node_modules/@fontsource/noto-sans-sc/files'), {
  fallthrough: true,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.use(express.static(path.resolve(__dirname, '../public'), { index: false }));

app.get('/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

app.get('/api/options', (_req, res) => {
  res.json({
    pageSizes: [
      { key: 'A4', label: 'A4 纵向（210 × 297 mm，推荐）' },
      { key: 'LETTER', label: 'Letter 纵向（8.5 × 11 in）' }
    ],
    walkingModes: Object.entries(WALKING_MODES).map(([key, value]) => ({ key, ...value })),
    fields: FIELD_SPECS,
    summaryRules: Object.entries(SUMMARY_SPECS).map(([key, value]) => ({ key, ...value }))
  });
});

app.get('/api/routes', async (_req, res, next) => {
  try {
    const result = await listRoutes();
    res.json({ routes: result.rows });
  } catch (err) { next(err); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
    const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username=$1', [username]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const session = createSession(user);
    res.json({ token: session.token, expiresInSeconds: session.expiresInSeconds, username: user.username });
  } catch (err) { next(err); }
});

app.post('/api/routes/:id/estimate', async (req, res, next) => {
  try {
    const evaluation = await evaluateRoute(req.params.id, req.body || {}, req.body?.versionId);
    if (evaluation.error) return res.status(evaluation.error.status).json({ error: evaluation.error.message });
    res.json({
      routeId: evaluation.routeId,
      versionId: evaluation.versionId,
      versionCode: evaluation.versionCode,
      infoDate: evaluation.infoDate,
      estimate: {
        fits: evaluation.estimate.fits,
        bodyHeightPt: evaluation.estimate.bodyHeightPt,
        availableHeightPt: evaluation.estimate.availableHeightPt,
        overflowHeightPt: evaluation.estimate.overflowHeightPt,
        fillRatio: evaluation.estimate.fillRatio,
        lineCount: evaluation.estimate.lineCount,
        minFontSizeUsedPt: evaluation.estimate.minFontSizeUsedPt,
        requiredErrors: evaluation.estimate.requiredErrors,
        omitted: evaluation.content.omitted
      },
      blocks: evaluation.content.blocks,
      layoutParams: evaluation.content.layoutParams
    });
  } catch (err) { next(err); }
});

app.post('/api/routes/:id/preview.pdf', async (req, res, next) => {
  try {
    const evaluation = await evaluateRoute(req.params.id, req.body || {}, req.body?.versionId);
    if (evaluation.error) return res.status(evaluation.error.status).json({ error: evaluation.error.message });
    if (!evaluation.estimate.fits) return res.status(422).json({ error: '预览内容溢出，请选择摘要规则', estimate: evaluation.estimate });
    // Reuse frozen preview path via buffer; preview itself is not a persisted task.
    const { renderPdfBuffer } = require('./layout');
    const pdf = await renderPdfBuffer(evaluation.content, {
      task_id: 'PREVIEW',
      route_version_code: evaluation.versionCode,
      info_date: evaluation.infoDate
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="route-card-preview.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf.buffer);
  } catch (err) { next(err); }
});

app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  requireAuth(req, res, next);
});

app.get('/api/tasks/recent', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, status, route_id, route_version_id, route_version_code,
              file_size, error_message, created_at, started_at, completed_at, expires_at,
              r.status AS route_status, rv.status AS version_status
       FROM card_tasks ct
       JOIN routes r ON r.id=ct.route_id
       JOIN route_versions rv ON rv.id=ct.route_version_id
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.user.sub]
    );
    res.json({ tasks: result.rows });
  } catch (err) { next(err); }
});

app.post('/api/tasks', async (req, res, next) => {
  try {
    const key = req.get('idempotency-key');
    const task = await createTask(req.user, req.body || {}, key);
    res.status(202).json({ task: { id: task.id, status: task.status }, restore: `/tasks/${task.id}` });
  } catch (err) { next(err); }
});

app.get('/api/tasks/:id', async (req, res, next) => {
  try {
    const task = await getTaskForUser(req.params.id, req.user.sub);
    if (!task) return res.status(404).json({ error: '任务不存在或不属于当前用户' });
    res.json({ task: publicTask(task) });
  } catch (err) { next(err); }
});

app.get('/api/tasks/:id/preview', async (req, res, next) => {
  try {
    const task = await getTaskForUser(req.params.id, req.user.sub);
    if (!task) return res.status(404).send('任务不存在');
    if (task.route_status === 'withdrawn' || task.version_status === 'withdrawn') {
      return res.status(410).send('路线已撤回，文件链接已过期');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.send(renderHtmlPreview(task.frozen_content, {
      task_id: task.id,
      route_version_code: task.route_version_code,
      info_date: task.source_snapshot?.info_date
    }));
  } catch (err) { next(err); }
});

app.post('/api/tasks/:id/download-token', async (req, res, next) => {
  try {
    const task = await getTaskForUser(req.params.id, req.user.sub);
    if (!task) return res.status(404).json({ error: '任务不存在或不属于当前用户' });
    if (task.route_status === 'withdrawn' || task.version_status === 'withdrawn') {
      await pool.query("UPDATE card_tasks SET status='expired' WHERE id=$1 AND status <> 'expired'", [task.id]);
      return res.status(410).json({ error: '路线已撤回，文件链接显示过期' });
    }
    if (task.status !== 'completed' || !task.file_path) {
      return res.status(409).json({ error: 'PDF 尚未生成完成' });
    }
    const issued = createDownloadToken(task.id, req.user.sub, Number(process.env.DOWNLOAD_TOKEN_TTL_SECONDS || 600));
    await pool.query(
      'INSERT INTO download_tokens(token_hash, task_id, user_id, expires_at) VALUES($1,$2,$3,$4)',
      [await hashToken(issued.token), task.id, req.user.sub, issued.expiresAt]
    );
    res.json({ downloadUrl: `/files/${task.id}/route-card.pdf?token=${encodeURIComponent(issued.token)}`, expiresInSeconds: issued.ttlSeconds });
  } catch (err) { next(err); }
});

app.get('/files/:id/route-card.pdf', async (req, res, next) => {
  let download;
  try {
    download = verifyDownloadToken(req.query.token);
    if (!download || download.taskId !== req.params.id) return res.status(401).json({ error: '下载链接无效或已过期，请重新鉴权' });

    const tokenHash = await hashToken(req.query.token);
    const tokenRow = await pool.query(
      'SELECT id, used_at FROM download_tokens WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',
      [tokenHash]
    );
    if (!tokenRow.rows[0] || tokenRow.rows[0].used_at) return res.status(401).json({ error: '下载链接已使用或已过期，请重新鉴权' });

    const result = await pool.query(
      `SELECT ct.*, r.status AS route_status, rv.status AS version_status
       FROM card_tasks ct
       JOIN routes r ON r.id=ct.route_id
       JOIN route_versions rv ON rv.id=ct.route_version_id
       WHERE ct.id=$1 AND ct.user_id=$2`,
      [download.taskId, download.userId]
    );
    const task = result.rows[0];
    if (!task) return res.status(404).json({ error: '文件不存在' });
    if (task.route_status === 'withdrawn' || task.version_status === 'withdrawn' || task.status === 'expired') {
      await pool.query("UPDATE card_tasks SET status='expired' WHERE id=$1", [task.id]);
      return res.status(410).json({ error: '路线已撤回，文件链接显示过期' });
    }
    if (task.status !== 'completed' || !task.file_path) return res.status(409).json({ error: '文件尚未生成完成' });

    await pool.query('UPDATE download_tokens SET used_at=now() WHERE token_hash=$1', [tokenHash]);
    const baseDir = path.resolve(fileDir());
    const filePath = path.resolve(task.file_path);
    if (!filePath.startsWith(baseDir + path.sep)) return res.status(400).json({ error: '非法文件路径' });
    await fs.access(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="route-card-${task.route_version_code}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(filePath, (err) => { if (err) next(err); });
  } catch (err) { next(err); }
});

app.post('/api/admin/routes/:id/withdraw', async (req, res, next) => {
  try {
    const client = await pool.connect();
    await client.query('BEGIN');
    const route = await client.query('SELECT id,status FROM routes WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!route.rows[0]) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: '路线不存在' });
    }
    await client.query("UPDATE routes SET status='withdrawn', updated_at=now() WHERE id=$1", [req.params.id]);
    await client.query("UPDATE route_versions SET status='withdrawn', withdrawn_at=now() WHERE route_id=$1", [req.params.id]);
    await client.query("UPDATE card_tasks SET status='expired' WHERE route_id=$1 AND status IN ('queued','rendering','completed')", [req.params.id]);
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true, status: 'withdrawn' });
  } catch (err) { next(err); }
});

function publicTask(task) {
  const stale = task.route_status === 'withdrawn' || task.version_status === 'withdrawn';
  return {
    id: task.id,
    status: stale ? 'expired' : task.status,
    routeId: task.route_id,
    routeVersionId: task.route_version_id,
    routeVersionCode: task.route_version_code,
    fileSize: task.file_size,
    errorMessage: task.error_message,
    createdAt: task.created_at,
    completedAt: task.completed_at,
    expiresAt: task.expires_at,
    linkState: stale ? '路线撤回：文件链接已过期' : null
  };
}

app.get('/tasks/:id', (_req, res) => res.sendFile(path.resolve(__dirname, '../public/index.html')));
app.get('/', (_req, res) => res.sendFile(path.resolve(__dirname, '../public/index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || '服务器内部错误', details: err.details });
});

const port = Number(process.env.PORT || 3000);
let workerState = { stop: false };

async function main() {
  if (String(process.env.AUTO_MIGRATE || 'true') !== 'false') {
    await migrate();
  }
  startWorker(workerState).catch((err) => {
    console.error('Worker stopped', err);
  });
  app.listen(port, () => console.log(`Route card generator listening on http://localhost:${port}`));
}

process.on('SIGTERM', async () => {
  workerState.stop = true;
  await pool.end();
  process.exit(0);
});

if (require.main === module) main().catch((err) => {
  console.error(err);
  process.exit(1);
});

module.exports = app;
