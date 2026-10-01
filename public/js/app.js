const state = {
  token: localStorage.getItem('routeCardToken') || '',
  username: localStorage.getItem('routeCardUsername') || '',
  options: { fields: [], walkingModes: [], summaryRules: [] },
  routes: [],
  currentEstimate: null,
  currentPayload: null,
  selectedRoute: null,
  restoreTaskId: null,
  pollTimer: null
};

const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error((data && data.error) || response.statusText);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function payload() {
  const routeSelect = $('routeSelect');
  const selected = state.routes.find((r) => r.id === routeSelect.value);
  return {
    routeId: routeSelect.value,
    versionId: selected?.version_id,
    pageSize: document.querySelector('input[name="pageSize"]:checked')?.value || 'A4',
    walkingMode: document.querySelector('input[name="walkingMode"]:checked')?.value || 'standard',
    summaryRule: document.querySelector('input[name="summaryRule"]:checked')?.value || 'full',
    fields: [...document.querySelectorAll('input[data-field]:checked')].map((x) => x.value)
  };
}

function setMessage(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = kind ? `${kind}` : '';
}

async function loadOptions() {
  state.options = await api('/api/options');
  $('walkingModes').innerHTML = state.options.walkingModes.map((mode, index) => `
    <label><input type="radio" name="walkingMode" value="${mode.key}" ${index === 0 ? 'checked' : ''}>
      <span><strong>${mode.label}</strong><br><span class="muted">${mode.paceLabel}</span></span>
    </label>`).join('');
  $('fieldOptions').innerHTML = state.options.fields.map((field) => `
    <label><input type="checkbox" data-field value="${field.key}" ${field.required ? 'checked data-required="true" disabled' : ''}>
      <span>${field.label} ${field.required ? '<span class="required">必需（不可取消）</span>' : ''}</span>
    </label>`).join('');
  $('summaryRules').innerHTML = state.options.summaryRules.map((rule, index) => `
    <label><input type="radio" name="summaryRule" value="${rule.key}" ${index === 0 ? 'checked' : ''}>
      <span><strong>${rule.label}</strong><br><span class="muted">${rule.description}</span></span>
    </label>`).join('');
}

async function loadRoutes() {
  const data = await api('/api/routes');
  state.routes = data.routes;
  $('routeSelect').innerHTML = '<option value="">请选择路线版本…</option>' + state.routes.map((route) => `
    <option value="${route.id}">${route.short_title || route.title}｜${route.version_code}</option>
  `).join('');
}

function updateAuthState() {
  $('authState').textContent = state.token
    ? `已登录：${state.username}。下载时仍会签发短期、一次性链接。`
    : '未登录：可选择路线和试算，创建/下载需登录。';
  $('submitBtn').disabled = !state.token;
  loadTasks();
}

function renderEstimate(data, error) {
  const box = $('estimate');
  if (error) {
    box.className = 'fit-bad';
    box.innerHTML = `<div class="pill bad">无法提交</div><p>${escapeHtml(error.message)}</p>`;
    $('submitBtn').disabled = true;
    $('refreshPreview').disabled = true;
    $('pdfPreviewLink').classList.add('disabled');
    return;
  }
  state.currentEstimate = data;
  const fits = data.estimate.fits;
  const overflowPct = Math.max(0, (data.estimate.fillRatio - 1) * 100).toFixed(1);
  const missing = data.estimate.requiredErrors || [];
  const omitted = data.estimate.omitted || [];
  box.className = fits ? 'fit-ok' : 'fit-bad';
  box.innerHTML = `
    <div class="estimate-grid">
      <div class="metric"><strong>${fits ? '可单页容纳' : '预计溢出'}</strong><span>最小字号 ${data.estimate.minFontSizeUsedPt}pt，不缩字</span></div>
      <div class="metric"><strong>${data.estimate.fillRatio.toFixed(2)}×</strong><span>占用/容量；溢出约 ${overflowPct}%</span></div>
      <div class="metric"><strong>${data.estimate.lineCount}</strong><span>估算文字行</span></div>
    </div>
    <span class="pill ${fits ? 'ok' : 'bad'}">${fits ? '通过容量检查' : '需选择摘要规则或删减可选字段'}</span>
    <div class="details">
      ${missing.length ? `<p><strong>必需信息缺失：</strong></p><ul>${missing.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
      ${omitted.length ? `<p><strong>按规则折叠/未选：</strong>${omitted.map(escapeHtml).join('、')}</p>` : ''}
      <p class="muted">依据与 PDFKit 相同的服务端排版引擎测量；厕所/饮水和整体资料的“待确认”会保留在卡片中。</p>
    </div>`;
  const canSubmit = Boolean(state.token && fits && !missing.length && acknowledgeOk());
  $('submitBtn').disabled = !canSubmit;
  $('refreshPreview').disabled = !fits;
  $('pdfPreviewLink').classList.toggle('disabled', !fits);
  $('ackSummary').setCustomValidity(canSubmit || state.currentPayload?.summaryRule === 'full' && fits ? '' : '请确认摘要规则');
}

function acknowledgeOk() {
  const rule = document.querySelector('input[name="summaryRule"]:checked')?.value || 'full';
  return rule === 'full' || $('ackSummary').checked;
}

async function estimate() {
  const body = payload();
  state.currentPayload = body;
  if (!body.routeId) return;
  const route = state.routes.find((r) => r.id === body.routeId);
  $('routeMeta').innerHTML = `<strong>${escapeHtml(route.title)}</strong><br>
    版本：${escapeHtml(route.version_code)}｜信息日期：${escapeHtml(route.info_date || '未记录')}｜
    标题用于卡片时最多18个汉字，长标题在版面中截断，完整标题仅存元数据。`;
  setMessage('formMessage', '正在用服务端版式估算…', 'warn');
  try {
    const data = await api(`/api/routes/${body.routeId}/estimate`, { method: 'POST', body: JSON.stringify(body) });
    renderEstimate(data);
    setMessage('formMessage', data.estimate.fits ? '容量检查通过。' : '内容超出单页，请明确选择摘要规则。', data.estimate.fits ? 'success' : 'warn');
    updatePreview(body);
  } catch (err) {
    renderEstimate(null, err);
    setMessage('formMessage', err.message, 'error');
  }
}

async function updatePreview(body) {
  try {
    const response = await fetch(`/api/routes/${body.routeId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('预览尚未通过容量检查');
    const text = await response.text();
    $('previewFrame').srcdoc = text;
  } catch (err) {
    $('previewFrame').srcdoc = `<p style="padding:1rem">${escapeHtml(err.message)}</p>`;
  }
}

async function submitTask() {
  if (!state.token) return setMessage('formMessage', '请先登录后再提交。', 'error');
  if (!acknowledgeOk()) return setMessage('formMessage', '请勾选摘要规则确认，确保未静默丢弃内容。', 'error');
  const body = payload();
  const key = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  $('submitBtn').disabled = true;
  try {
    const result = await api('/api/tasks', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body)
    });
    setMessage('formMessage', `任务已提交：${result.task.id}，正在后台渲染。页面关闭后可恢复。`, 'success');
    history.replaceState(null, '', `/tasks/${result.task.id}`);
    await loadTasks();
    pollTask(result.task.id);
  } catch (err) {
    setMessage('formMessage', err.data?.details?.length ? `${err.message}：${err.data.details.join('；')}` : err.message, 'error');
    $('submitBtn').disabled = false;
  }
}

async function loadTasks() {
  if (!state.token) {
    $('taskList').textContent = '登录后显示最近任务。';
    return;
  }
  const data = await api('/api/tasks/recent');
  if (!data.tasks.length) {
    $('taskList').textContent = '暂无任务。';
    return;
  }
  const template = $('taskTemplate');
  $('taskList').innerHTML = '';
  data.tasks.forEach((task) => {
    const node = template.content.cloneNode(true);
    node.querySelector('.task-title').textContent = `${task.route_version_code}`;
    node.querySelector('.task-meta').textContent = `创建 ${new Date(task.created_at).toLocaleString()} · ${task.id.slice(0, 8)}`;
    const status = node.querySelector('.task-status');
    status.textContent = statusLabel(task);
    status.className = `task-status status-${task.status}`;
    const preview = node.querySelector('.task-preview');
    preview.href = `/api/tasks/${task.id}/preview?access_token=${encodeURIComponent(state.token)}`;
    const download = node.querySelector('.task-download');
    download.disabled = task.status !== 'completed';
    download.addEventListener('click', () => downloadTask(task.id));
    $('taskList').appendChild(node);
    if (['queued', 'rendering'].includes(task.status)) pollTask(task.id);
  });
}

function statusLabel(task) {
  if (task.route_status === 'withdrawn' || task.version_status === 'withdrawn' || task.status === 'expired') return '路线撤回：链接已过期';
  return { queued: '排队中（可恢复）', rendering: '生成中（重启会重排队）', completed: '已完成，可重新鉴权下载', failed: `失败：${task.error_message || '渲染失败'}` }[task.status] || task.status;
}

function pollTask(id) {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(async function tick() {
    try {
      const data = await api(`/api/tasks/${id}`);
      await loadTasks();
      if (['queued', 'rendering'].includes(data.task.status)) state.pollTimer = setTimeout(tick, 700);
    } catch (_) { /* 401 or transient error: recent list will show state */ }
  }, 500);
}

async function downloadTask(id) {
  try {
    const data = await api(`/api/tasks/${id}/download-token`, { method: 'POST' });
    window.location.assign(data.downloadUrl);
  } catch (err) {
    alert(err.message);
    if (err.status === 401) {
      state.token = '';
      localStorage.removeItem('routeCardToken');
      updateAuthState();
    }
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function bindEvents() {
  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: $('username').value, password: $('password').value })
      });
      state.token = data.token;
      state.username = data.username;
      localStorage.setItem('routeCardToken', data.token);
      localStorage.setItem('routeCardUsername', data.username);
      updateAuthState();
      if (state.currentEstimate) renderEstimate(state.currentEstimate);
    } catch (err) {
      $('authState').textContent = err.message;
    }
  });
  $('routeSelect').addEventListener('change', estimate);
  document.addEventListener('change', (event) => {
    if (event.target.matches('input[name="pageSize"], input[name="walkingMode"], input[name="summaryRule"], input[data-field], #ackSummary')) {
      estimate();
    }
  });
  $('estimateBtn').addEventListener('click', estimate);
  $('submitBtn').addEventListener('click', submitTask);
  $('refreshPreview').addEventListener('click', () => state.currentPayload && updatePreview(state.currentPayload));
  $('pdfPreviewLink').addEventListener('click', async (event) => {
    event.preventDefault();
    if (!state.currentPayload || $('pdfPreviewLink').classList.contains('disabled')) return;
    const response = await fetch(`/api/routes/${state.currentPayload.routeId}/preview.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.currentPayload)
    });
    if (!response.ok) return alert('PDF 预览未通过容量检查');
    const blob = await response.blob();
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  });
}

async function init() {
  const match = window.location.pathname.match(/^\/tasks\/([0-9a-f-]+)/i);
  state.restoreTaskId = match ? match[1] : null;
  bindEvents();
  updateAuthState();
  await Promise.all([loadOptions(), loadRoutes()]);
  if (state.restoreTaskId && state.token) pollTask(state.restoreTaskId);
}

init().catch((err) => setMessage('formMessage', `初始化失败：${err.message}`, 'error'));
