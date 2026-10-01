const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');

const {
  buildCardModel,
  createPdfMeasurer,
  measureCard,
  WALKING_MODES,
  SUMMARY_RULES,
  ALLOWED_FIELDS,
  FONT_REGULAR,
  FONT_BOLD,
  sanitizeRoute
} = require('./layout');
const { renderPdf } = require('./render-pdf');
const { renderPreviewHtml } = require('./render-html');
const { createStore, uuid } = require('./store');

const PORT = Number(process.env.PORT || 3000);
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || (process.env.NODE_ENV === 'production'
  ? null
  : 'development-secret-change-me');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (process.env.NODE_ENV === 'production' ? null : 'development-admin-token');
if (!DOWNLOAD_SECRET) {
  throw new Error('生产环境必须配置 DOWNLOAD_SECRET，以签发下载短令牌。');
}
if (!ADMIN_TOKEN) {
  throw new Error('生产环境必须配置 ADMIN_TOKEN，以保护路线撤回操作。');
}
const TTL_SECONDS = Number(process.env.DOWNLOAD_TOKEN_TTL_SECONDS || 60);
const ROOT = path.join(__dirname, '..', '..');
const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const app = express();

app.use(express.json({ limit: '256kb' }));

function publicRoute(route) {
  if (!route) return null;
  const clean = sanitizeRoute({ ...route.data, id: route.id, ...route.data });
  return {
    id: route.id,
    routeId: route.routeId,
    version: route.version,
    shortTitle: route.shortTitle,
    title: route.title,
    status: route.status,
    publishedAt: route.publishedAt,
    infoDate: route.infoDate,
    withdrawnReason: route.data?.withdrawnReason,
    data: clean
  };
}

function ownerKey(req) {
  const provided = req.get('X-Owner-Key') || req.query.owner_key || '';
  if (!provided) {
    const err = new Error('缺少 X-Owner-Key；下载必须先由已授权任务接口签发短令牌。');
    err.status = 401;
    throw err;
  }
  return crypto.createHash('sha256').update(String(provided)).digest('hex');
}

function signToken(jobId, tokenId, expiresAt) {
  return crypto.createHmac('sha256', DOWNLOAD_SECRET)
    .update(`${jobId}.${tokenId}.${expiresAt}`)
    .digest('hex');
}

function requireAdmin(req, res, next) {
  const supplied = req.get('X-Admin-Token') || '';
  const expected = ADMIN_TOKEN;
  const ok = supplied.length === expected.length &&
    supplied.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!ok) return res.status(403).json({ error: 'admin_forbidden', message: '路线撤回需要管理员令牌。' });
  next();
}

function selectedFields(body) {
  const fields = Array.isArray(body.fields) ? body.fields : [];
  return ALLOWED_FIELDS.filter(f => fields.includes(f));
}

function previewQueryString(body, fields) {
  const params = new URLSearchParams({
    routeVersionId: body.routeVersionId,
    walkingMode: body.walkingMode,
    summaryRule: body.summaryRule
  });
  fields.forEach(f => params.append('fields', f));
  return params.toString();
}

async function computeRequest(store, body) {
  const walkingMode = WALKING_MODES[body.walkingMode] ? body.walkingMode : null;
  const summaryRule = SUMMARY_RULES[body.summaryRule] ? body.summaryRule : null;
  if (!walkingMode) throw Object.assign(new Error('walkingMode 必须是 leisure、standard 或 fast'), { status: 400 });
  if (!summaryRule) throw Object.assign(new Error('summaryRule 必须是 essential、landmarks 或 full'), { status: 400 });

  const routeRecord = await store.getRoute(String(body.routeVersionId || ''));
  if (!routeRecord) throw Object.assign(new Error('路线版本不存在'), { status: 404 });
  if (routeRecord.status === 'withdrawn') throw Object.assign(new Error('该路线版本已撤回，不能生成新卡'), { status: 410 });

  const fields = selectedFields(body);
  const model = buildCardModel(routeRecord.data, { walkingMode, summaryRule, fields });
  const required = [
    [model.route.start.name, '起点'],
    [model.route.end.name, '终点'],
    [model.walking.text, '估算用时'],
    [model.route.infoDate, '信息日期']
  ];
  for (const [value, label] of required) {
    if (!value) throw Object.assign(new Error(`路线版本缺少必需信息：${label}`), { status: 422 });
  }
  if (!model.route.exits.length) throw Object.assign(new Error('路线版本缺少必需信息：撤出点'), { status: 422 });
  if (!model.route.cautions.length) throw Object.assign(new Error('路线版本缺少必需信息：注意事项'), { status: 422 });
  const measurer = createPdfMeasurer();
  const estimate = measureCard(model, measurer);
  return { routeRecord, model, estimate, fields };
}

function serializeJob(store, job) {
  const route = job.frozenContent?.route;
  return {
    id: job.id,
    status: job.status,
    routeVersionId: job.routeVersionId,
    shortTitle: route?.shortTitle,
    cardVersion: job.frozenContent?.cardVersion,
    infoDate: route?.infoDate,
    walkingMode: job.walkingMode,
    fields: job.fields,
    summaryRule: job.summaryRule,
    estimate: job.estimate,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    previewUrl: `/api/card-jobs/${job.id}/preview`,
    downloadUrl: job.status === 'completed' ? `/api/card-jobs/${job.id}/download/request` : null,
    routeWithdrawn: route?.status === 'withdrawn'
  };
}

async function startWorker(store) {
  let running = true;
  while (running) {
    let job;
    try {
      job = await store.claimNextQueued();
    } catch (err) {
      console.error('claim job failed', err);
    }

    if (!job) {
      await new Promise(resolve => setTimeout(resolve, 250));
      continue;
    }

    try {
      await fsp.mkdir(STORAGE_DIR, { recursive: true });
      const filePath = path.join(STORAGE_DIR, `${job.id}-${job.frozenContent.cardVersion}.pdf`);
      const output = fs.createWriteStream(filePath);
      await renderPdf(job.frozenContent, output);
      await store.completeJob(job.id, filePath);
    } catch (err) {
      console.error('render failed', job.id, err);
      await store.failJob(job.id, err);
    }
  }
}

async function validateOwnJob(store, req, res) {
  const job = await store.getJob(req.params.id, ownerKey(req));
  if (!job) {
    res.status(404).json({ error: '任务不存在或无权访问' });
    return null;
  }
  return job;
}

async function createServer(store) {
  await fsp.mkdir(STORAGE_DIR, { recursive: true });
  app.locals.store = store;

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/route-versions', async (_req, res, next) => {
    try {
      const routes = await store.listRoutes();
      res.json({ routes: routes.map(publicRoute) });
    } catch (err) { next(err); }
  });

  app.get('/api/route-versions/:id', async (req, res, next) => {
    try {
      const route = await store.getRoute(req.params.id);
      if (!route) return res.status(404).json({ error: '路线版本不存在' });
      res.json({ route: publicRoute(route) });
    } catch (err) { next(err); }
  });

  app.post('/api/route-versions/:id/withdraw', requireAdmin, async (req, res, next) => {
    try {
      const reason = String(req.body?.reason || '路线撤回').slice(0, 200);
      const route = await store.withdrawRoute(req.params.id, reason);
      if (!route) return res.status(404).json({ error: '路线版本不存在' });
      res.json({ route: publicRoute(route) });
    } catch (err) { next(err); }
  });

  app.post('/api/card-estimates', async (req, res, next) => {
    try {
      const result = await computeRequest(store, req.body || {});
      res.json({
        fits: result.estimate.fits,
        estimate: result.estimate,
        summaryRule: result.model.summaryRule,
        fields: result.fields,
        previewUrl: '/api/card-preview?' + previewQueryString(req.body, result.fields),
        requiredSections: ['起终点', '撤出点', '注意事项'],
        message: result.estimate.fits
          ? '内容可在单页 A4 内以不低于 9 pt 的字号呈现。'
          : '当前选择会溢出单页。请改选明确的摘要规则或减少可选字段；必需内容不会被静默丢弃。'
      });
    } catch (err) { next(err); }
  });

  app.post('/api/card-preview/html', async (req, res, next) => {
    try {
      const result = await computeRequest(store, req.body || {});
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderPreviewHtml(result.model, { frozen: false }));
    } catch (err) { next(err); }
  });

  app.get('/api/card-preview', async (req, res, next) => {
    try {
      const fields = typeof req.query.fields === 'string' ? [req.query.fields] : req.query.fields || [];
      const result = await computeRequest(store, {
        routeVersionId: req.query.routeVersionId,
        walkingMode: req.query.walkingMode,
        summaryRule: req.query.summaryRule,
        fields
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderPreviewHtml(result.model, { frozen: false }));
    } catch (err) { next(err); }
  });

  app.post('/api/card-jobs', async (req, res, next) => {
    try {
      const result = await computeRequest(store, req.body || {});
      if (!result.estimate.fits) {
        return res.status(422).json({
          error: 'single_page_overflow',
          message: '完整规则仍然超过单页容量。不能靠缩小字号硬塞，请改选关键岔路或路标抽样。',
          estimate: result.estimate
        });
      }

      const id = uuid();
      const sourceRefs = result.routeRecord.data.sources || [];
      const job = await store.createJob({
        id,
        ownerKey: ownerKey(req),
        routeVersionId: result.routeRecord.id,
        walkingMode: req.body.walkingMode,
        fields: result.fields,
        summaryRule: req.body.summaryRule,
        layoutParams: result.model.layout,
        frozenContent: result.model,
        estimate: result.estimate,
        sourceRefs
      });
      res.status(202).json({ job: serializeJob(store, job) });
    } catch (err) { next(err); }
  });

  app.get('/api/card-jobs', async (req, res, next) => {
    try {
      const jobs = await store.listJobs(ownerKey(req));
      res.json({ jobs: jobs.map(j => serializeJob(store, j)) });
    } catch (err) { next(err); }
  });

  app.get('/api/card-jobs/:id', async (req, res, next) => {
    try {
      const job = await validateOwnJob(store, req, res);
      if (!job) return;
      const route = await store.getRoute(job.routeVersionId);
      res.json({ job: { ...serializeJob(store, job), routeWithdrawn: route?.status === 'withdrawn' } });
    } catch (err) { next(err); }
  });

  app.get('/api/card-jobs/:id/preview', async (req, res, next) => {
    try {
      const job = await validateOwnJob(store, req, res);
      if (!job) return;
      const route = await store.getRoute(job.routeVersionId);
      if (route?.status === 'withdrawn') {
        return res.status(410).send(renderPreviewHtml({
          ...job.frozenContent,
          route: { ...job.frozenContent.route, status: 'withdrawn' }
        }, { frozen: true, title: '路线已撤回' }).replace('路线打印卡 · 服务端统一 A4 版式 · 无地图截图', '文件链接已过期：路线版本已撤回'));
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderPreviewHtml(job.frozenContent, { frozen: true }));
    } catch (err) { next(err); }
  });

  app.post('/api/card-jobs/:id/download/request', async (req, res, next) => {
    try {
      const job = await validateOwnJob(store, req, res);
      if (!job) return;
      const route = await store.getRoute(job.routeVersionId);
      if (route?.status === 'withdrawn') return res.status(410).json({ error: 'route_withdrawn', message: '路线已撤回，文件链接显示过期。' });
      if (job.status !== 'completed' || !job.filePath) return res.status(409).json({ error: 'job_not_ready', message: 'PDF 尚未完成生成。' });

      const tokenId = uuid();
      const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
      const signature = signToken(job.id, tokenId, expiresAt);
      await store.createToken({ id: tokenId, jobId: job.id, ownerKey: ownerKey(req), signature, expiresAt });
      const url = `/api/card-jobs/${job.id}/download?t=${tokenId}&sig=${signature}&expires=${encodeURIComponent(expiresAt)}`;
      res.json({ downloadUrl: url, expiresAt, ttlSeconds: TTL_SECONDS, method: 'GET', oneTime: true });
    } catch (err) { next(err); }
  });

  app.get('/api/card-jobs/:id/download', async (req, res, next) => {
    try {
      const tokenId = String(req.query.t || '');
      const signature = String(req.query.sig || '');
      const expectedExpires = String(req.query.expires || '');
      const expectedSig = signToken(req.params.id, tokenId, expectedExpires);
      const validLength = signature.length === expectedSig.length;
      const validSig = validLength && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
      if (!tokenId || !validSig || new Date(expectedExpires) <= new Date()) {
        return res.status(401).json({ error: 'download_unauthorized', message: '下载链接无效或已过期，请重新鉴权。' });
      }
      const job = await store.consumeToken(tokenId, signature);
      if (!job || job.id !== req.params.id) return res.status(401).json({ error: 'download_unauthorized', message: '下载链接已使用或失效，请重新鉴权。' });
      const route = await store.getRoute(job.routeVersionId);
      if (route?.status === 'withdrawn') return res.status(410).json({ error: 'route_withdrawn', message: '路线已撤回，文件链接已过期。' });
      if (job.status !== 'completed' || !job.filePath) return res.status(409).json({ error: 'job_not_ready' });
      await fsp.access(job.filePath);
      const filename = `route-card-${job.frozenContent.cardVersion}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      fs.createReadStream(job.filePath).on('error', next).pipe(res);
    } catch (err) { next(err); }
  });

  app.get('/fonts/:name', (req, res, next) => {
    if (req.params.name === 'noto-regular.ttf') return res.sendFile(FONT_REGULAR, next);
    if (req.params.name === 'noto-bold.ttf') return res.sendFile(FONT_BOLD, next);
    res.status(404).end();
  });

  const staticFiles = new Set(['route-cards.html', 'css/route-cards.css', 'js/route-cards.js']);
  app.get('/:name', (req, res, next) => {
    if (staticFiles.has(req.params.name) || staticFiles.has(`css/${req.params.name}`) || staticFiles.has(`js/${req.params.name}`)) {
      return res.sendFile(path.join(ROOT, req.params.name));
    }
    next();
  });
  app.get('/css/:name', (req, res, next) => {
    if (req.params.name === 'route-cards.css') return res.sendFile(path.join(ROOT, 'css', req.params.name));
    next();
  });
  app.get('/js/:name', (req, res, next) => {
    if (req.params.name === 'route-cards.js') return res.sendFile(path.join(ROOT, 'js', req.params.name));
    next();
  });
  app.get('/', (_req, res) => res.redirect('/route-cards.html'));

  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.name || 'server_error', message: err.message || '服务异常' });
  });

  startWorker(store).catch(err => console.error('worker stopped', err));
  return app;
}

if (require.main === module) {
  createStore().then(createStoreReady => createServer(createStoreReady)).then(server => {
    server.listen(PORT, () => console.log(`Route card server listening on http://localhost:${PORT}`));
  }).catch(err => {
    console.error('failed to start', err);
    process.exit(1);
  });
}

module.exports = { createServer, createStore, app };
