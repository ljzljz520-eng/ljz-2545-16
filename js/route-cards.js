const API = '';
const form = document.querySelector('#cardForm');
const routeSelect = document.querySelector('#routeVersion');
const estimateBox = document.querySelector('#estimate');
const submitBtn = document.querySelector('#submitBtn');
const estimateBtn = document.querySelector('#estimateBtn');
const previewFrame = document.querySelector('#previewFrame');
const jobsList = document.querySelector('#jobsList');
const jobTemplate = document.querySelector('#jobTemplate');

let routes = [];
let lastEstimate = null;
let pollTimer = null;

function ownerKey() {
  let key = localStorage.getItem('route-card-owner-key');
  if (!key) {
    key = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem('route-card-owner-key', key);
  }
  return key;
}

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Key': ownerKey(),
      ...(options.headers || {})
    }
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw Object.assign(new Error(body.message || body.error || '请求失败'), { status: response.status, body });
  return body;
}

function payload() {
  return {
    routeVersionId: routeSelect.value,
    walkingMode: new FormData(form).get('walkingMode'),
    summaryRule: new FormData(form).get('summaryRule'),
    fields: Array.from(new FormData(form).getAll('fields'))
  };
}

function previewUrl(data) {
  const params = new URLSearchParams({
    routeVersionId: data.routeVersionId,
    walkingMode: data.walkingMode,
    summaryRule: data.summaryRule
  });
  data.fields.forEach(f => params.append('fields', f));
  return `/api/card-preview?${params}`;
}

function statusText(job) {
  if (job.routeWithdrawn) return ['withdrawn', '路线已撤回：文件链接显示过期，不能继续下载。'];
  if (job.status === 'completed') return ['completed', '已完成：内容已冻结，可重新鉴权下载。'];
  if (job.status === 'rendering') return ['rendering', '正在后台渲染单页 PDF，页面刷新后仍可恢复。'];
  if (job.status === 'failed') return ['failed', `生成失败：${job.error || '请重试'}`];
  return ['queued', '排队中：任务已持久化，长路线不会阻断其它操作。'];
}

async function loadRoutes() {
  const data = await api('/api/route-versions');
  routes = data.routes;
  routeSelect.innerHTML = routes.map(route => {
    const suffix = route.status === 'withdrawn' ? '（已撤回）' : ` v${route.version}`;
    return `<option value="${route.id}" ${route.status === 'withdrawn' ? 'disabled' : ''}>${route.shortTitle}${suffix} · 信息日期 ${route.infoDate}</option>`;
  }).join('');
}

async function estimate({ updatePreview = true } = {}) {
  if (!routeSelect.value) return;
  submitBtn.disabled = true;
  estimateBox.className = 'estimate';
  estimateBox.innerHTML = '<strong>正在估算…</strong>正在以嵌入 PDF 的中文字体度量 A4 单页容量。';
  try {
    const data = payload();
    const result = await api('/api/card-estimates', { method: 'POST', body: JSON.stringify(data) });
    lastEstimate = result;
    const e = result.estimate;
    estimateBox.className = `estimate ${result.fits ? 'ok' : 'bad'}`;
    estimateBox.innerHTML = `
      <strong>${result.fits ? '✓ 可放入单页' : '× 会溢出单页'}</strong>
      ${result.message}<br>
      已用高度 ${e.usedHeight}pt / ${e.maxHeight}pt${result.fits ? '' : `，溢出 ${e.overflowHeight}pt`}。<br>
      摘要规则：${result.summaryRule.label}。必需的起终点、撤出点、注意事项均保留。
    `;
    submitBtn.disabled = !result.fits;
    if (updatePreview) previewFrame.src = previewUrl(data);
  } catch (err) {
    estimateBox.className = 'estimate bad';
    estimateBox.innerHTML = `<strong>无法估算</strong>${err.message}`;
  }
}

async function loadJobs() {
  const data = await api('/api/card-jobs');
  jobsList.innerHTML = '';
  if (!data.jobs.length) {
    jobsList.innerHTML = '<p class="hint">暂无任务。提交后刷新页面，任务仍会显示在这里。</p>';
    return { active: false };
  }

  let active = false;
  for (const job of data.jobs) {
    const node = jobTemplate.content.firstElementChild.cloneNode(true);
    const [statusClass, text] = statusText(job);
    node.querySelector('h3').textContent = `${job.shortTitle} · ${job.cardVersion}`;
    node.querySelector('.job-meta').textContent = `步行：${job.walkingMode}｜摘要：${job.summaryRule}｜信息日期：${job.infoDate}｜创建：${new Date(job.createdAt).toLocaleString()}`;
    const status = node.querySelector('.job-status');
    status.className = `job-status ${statusClass}`;
    status.textContent = text;

    const preview = node.querySelector('a');
    preview.href = job.previewUrl;
    const download = node.querySelector('.download');
    download.disabled = job.status !== 'completed' || job.routeWithdrawn;
    download.addEventListener('click', () => downloadJob(job.id));
    jobsList.appendChild(node);
    if (['queued', 'rendering'].includes(job.status)) active = true;
  }
  return { active };
}

async function pollJobs() {
  const { active } = await loadJobs();
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = active ? setTimeout(pollJobs, 1200) : null;
}

async function downloadJob(id) {
  try {
    const result = await api(`/api/card-jobs/${id}/download/request`, { method: 'POST' });
    window.location.href = result.downloadUrl;
  } catch (err) {
    alert(err.status === 410 ? '路线已撤回，旧文件链接已过期。' : err.message);
    loadJobs();
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!lastEstimate?.fits) return;
  submitBtn.disabled = true;
  try {
    await api('/api/card-jobs', { method: 'POST', body: JSON.stringify(payload()) });
    await pollJobs();
  } catch (err) {
    alert(err.message);
    submitBtn.disabled = false;
  }
});

estimateBtn.addEventListener('click', () => estimate());
routeSelect.addEventListener('change', () => estimate());
form.addEventListener('change', () => estimate());
document.querySelector('#refreshJobs').addEventListener('click', pollJobs);

(async function init() {
  await loadRoutes();
  await estimate();
  await pollJobs();
})();
