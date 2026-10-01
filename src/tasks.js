const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pool = require('./db/pool');
const { buildCardContent, measureContent, renderPdfBuffer, FIELD_SPECS, SUMMARY_SPECS, WALKING_MODES, PAGE_SIZES } = require('./layout');

const PUBLIC_VERSION_FIELDS = `
  rv.id, rv.route_id, rv.version_code, rv.revision, rv.status AS version_status,
  rv.content, rv.published_at, rv.withdrawn_at,
  r.title, r.short_title, r.status AS route_status
`;

async function getPublicRouteVersion(routeId, versionId = null) {
  const result = versionId
    ? await pool.query(
        `SELECT ${PUBLIC_VERSION_FIELDS}
         FROM route_versions rv JOIN routes r ON r.id = rv.route_id
         WHERE rv.route_id=$1 AND rv.id=$2`,
        [routeId, versionId]
      )
    : await pool.query(
        `SELECT ${PUBLIC_VERSION_FIELDS}
         FROM route_versions rv JOIN routes r ON r.id = rv.route_id
         WHERE rv.route_id=$1 AND rv.id=r.current_version_id`,
        [routeId]
      );
  const row = result.rows[0];
  if (!row) return { error: { status: 404, message: '路线版本不存在' } };
  if (row.route_status === 'withdrawn' || row.version_status === 'withdrawn') {
    return { error: { status: 410, message: '路线已撤回，文件链接显示过期' } };
  }
  return { version: row };
}

function listRoutes() {
  return pool.query(
    `SELECT r.id, r.title, r.short_title, r.status,
            rv.id AS version_id, rv.version_code, rv.revision, rv.published_at,
            rv.content->'sources'->0->>'info_date' AS info_date
     FROM routes r
     JOIN route_versions rv ON rv.id = r.current_version_id
     WHERE r.status='published' AND rv.status='published'
     ORDER BY r.updated_at DESC, r.title ASC`
  );
}

async function getTaskForUser(taskId, userId) {
  const result = await pool.query(
    `SELECT ct.*, r.status AS route_status, rv.status AS version_status
     FROM card_tasks ct
     JOIN routes r ON r.id=ct.route_id
     JOIN route_versions rv ON rv.id=ct.route_version_id
     WHERE ct.id=$1 AND (ct.user_id=$2 OR $2 IS NULL)`,
    [taskId, userId || null]
  );
  return result.rows[0] || null;
}

function extractPublicContent(row) {
  const content = row.content || {};
  // 白名单输出：editor_private 不进入接口、冻结内容或 PDF。
  const { editor, internal_note, editor_private, private_notes, ...safeSourceRest } = content.sources?.[0] || {};
  const source = { ...safeSourceRest };
  return {
    ...content,
    title: content.title || row.title,
    short_title: content.short_title || row.short_title,
    version_code: row.version_code,
    sources: [source]
  };
}

function normalizeCardOptions(body = {}) {
  const allowedFields = new Set(FIELD_SPECS.map((field) => field.key));
  const requiredFields = new Set(FIELD_SPECS.filter((field) => field.required).map((field) => field.key));
  const fields = Array.isArray(body.fields)
    ? [...new Set(body.fields.filter((key) => allowedFields.has(key)))]
    : [];
  requiredFields.forEach((key) => {
    if (!fields.includes(key)) fields.push(key);
  });
  return {
    fields,
    summaryRule: SUMMARY_SPECS[body.summaryRule] ? body.summaryRule : 'full',
    walkingMode: WALKING_MODES[body.walkingMode] ? body.walkingMode : 'standard',
    pageSize: PAGE_SIZES[body.pageSize] ? body.pageSize : 'A4'
  };
}

async function evaluateRoute(routeId, body = {}, versionId = null) {
  if (!UUID_RE.test(routeId) || (versionId && !UUID_RE.test(versionId))) {
    return { error: { status: 400, message: '路线或版本 ID 格式无效' } };
  }
  const found = await getPublicRouteVersion(routeId, versionId);
  if (found.error) return found;
  const route = extractPublicContent(found.version);
  const options = normalizeCardOptions(body);
  const content = buildCardContent(route, options);
  const estimate = measureContent(content);
  return {
    routeId,
    versionId: found.version.id,
    versionCode: found.version.version_code,
    infoDate: found.version.content?.sources?.[0]?.info_date || found.version.published_at,
    publicRoute: route,
    content,
    estimate,
    availableSummaryRules: Object.entries(require('./layout').SUMMARY_SPECS).map(([key, spec]) => ({ key, ...spec }))
  };
}

async function createTask(user, body, idempotencyKey) {
  if (!body.routeId) throw Object.assign(new Error('routeId 必填'), { status: 400 });
  if (idempotencyKey) {
    const existing = await pool.query(
      `SELECT id, status FROM card_tasks WHERE idempotency_key=$1 AND user_id=$2`,
      [idempotencyKey, user.sub]
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  const evaluation = await evaluateRoute(body.routeId, body, body.versionId);
  if (evaluation.error) {
    const err = new Error(evaluation.error.message);
    err.status = evaluation.error.status;
    throw err;
  }
  if (evaluation.estimate.requiredErrors.length) {
    const err = new Error('必需的起终点、退出点或注意事项缺失，不能静默丢弃');
    err.status = 422;
    err.details = evaluation.estimate.requiredErrors;
    throw err;
  }
  if (!evaluation.estimate.fits) {
    const err = new Error('内容仍会溢出单页；请选择明确摘要规则或减少可选字段，禁止缩小到不可读字体');
    err.status = 422;
    err.estimate = {
      overflowHeightPt: evaluation.estimate.overflowHeightPt,
      fillRatio: evaluation.estimate.fillRatio,
      omitted: evaluation.content.omitted
    };
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT r.status AS route_status, rv.status AS version_status, rv.revision
       FROM routes r
       JOIN route_versions rv ON rv.id = $2 AND rv.route_id = r.id
       WHERE r.id=$1 FOR UPDATE OF r`,
      [body.routeId, evaluation.versionId]
    );
    if (!locked.rows[0] || locked.rows[0].route_status === 'withdrawn' || locked.rows[0].version_status === 'withdrawn') {
      throw Object.assign(new Error('路线已撤回，不能生成卡片'), { status: 410 });
    }

    const result = await client.query(
      `INSERT INTO card_tasks(
         user_id, route_id, route_version_id, route_version_code, status,
         frozen_content, layout_params, source_snapshot, estimate, idempotency_key
       ) VALUES ($1,$2,$3,$4,'queued',$5,$6,$7,$8,$9)
       RETURNING id,status,created_at`,
      [
        user.sub,
        body.routeId,
        evaluation.versionId,
        evaluation.versionCode,
        JSON.stringify(evaluation.content),
        JSON.stringify(evaluation.content.layoutParams),
        JSON.stringify({
          infoDate: evaluation.infoDate,
          route: evaluation.publicRoute,
          sources: evaluation.publicRoute.sources,
          frozenAt: new Date().toISOString()
        }),
        JSON.stringify(evaluation.estimate),
        idempotencyKey || null
      ]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function fileDir() {
  return path.resolve(process.env.CARD_FILE_DIR || path.join(__dirname, '../data/generated'));
}

function fileNameFor(task) {
  const safe = (task.frozen_content?.displayTitle || 'route-card').replace(/[\\/:*?"<>|\s]+/g, '-');
  return `${task.id}-${safe}-${task.route_version_code}.pdf`.replace(/-+/g, '-');
}

async function renderTask(task) {
  const frozenTask = {
    task_id: task.id,
    route_version_code: task.route_version_code,
    info_date: task.source_snapshot?.info_date || task.frozen_content?.blocks?.[0]?.text
  };
  const { buffer, overflowed } = await renderPdfBuffer(task.frozen_content, frozenTask);
  if (overflowed || buffer.length === 0) {
    throw new Error('服务端最终排版检测到溢出；任务标记失败，未发布文件');
  }
  const dir = fileDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileNameFor(task));
  await fs.writeFile(filePath, buffer);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return { filePath, size: buffer.length, sha256: hash, buffer };
}

async function claimNextTask() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE card_tasks
       SET status='rendering', started_at=now()
       WHERE id=(
         SELECT id FROM card_tasks
         WHERE status='queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function completeTask(taskId, file) {
  await pool.query(
    `UPDATE card_tasks
     SET status='completed', file_path=$1, file_sha256=$2, file_size=$3,
         completed_at=now(), expires_at=now() + interval '30 days', error_message=NULL
     WHERE id=$4 AND status='rendering'`,
    [file.filePath, file.sha256, file.size, taskId]
  );
}

async function failTask(taskId, message) {
  await pool.query(
    `UPDATE card_tasks
     SET status='failed', error_message=$2,
         file_path=CASE WHEN status='rendering' THEN file_path ELSE NULL END
     WHERE id=$1`,
    [taskId, String(message).slice(0, 1000)]
  );
}

async function resetInterruptedTasks() {
  await pool.query(
    `UPDATE card_tasks SET status='queued', started_at=NULL
     WHERE status='rendering'`
  );
}

async function startWorker(running = { stop: false }, intervalMs = 300) {
  await resetInterruptedTasks();
  while (!running.stop) {
    const task = await claimNextTask();
    if (!task) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    try {
      const file = await renderTask(task);
      await completeTask(task.id, file);
    } catch (err) {
      console.error(`Render task ${task.id} failed`, err);
      await failTask(task.id, err.message);
    }
  }
}

module.exports = {
  listRoutes,
  getPublicRouteVersion,
  extractPublicContent,
  evaluateRoute,
  createTask,
  getTaskForUser,
  renderTask,
  claimNextTask,
  startWorker,
  resetInterruptedTasks,
  fileDir
};
