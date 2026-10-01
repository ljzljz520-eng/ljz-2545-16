const { formatDate } = require('./layout');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function chip(text, tone = 'normal') {
  return `<span class="chip ${tone}">${esc(text)}</span>`;
}

function item(text, cls = '', bold = false) {
  return `<p class="item ${cls} ${bold ? 'bold' : ''}">${esc(text)}</p>`;
}

function renderPreviewHtml(model, { frozen = false, title = '路线打印卡预览' } = {}) {
  const statusTone = model.route.infoStatus === '信息日期已核' ? 'ok' : 'warn';
  const terrain = model.terrain.length
    ? `<div class="chip-row">${model.terrain.map(v => chip(v)).join('')}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
@font-face { font-family: 'Noto Sans SC'; src: url('/fonts/noto-regular.ttf') format('truetype'); font-weight: 400; }
@font-face { font-family: 'Noto Sans SC'; src: url('/fonts/noto-bold.ttf') format('truetype'); font-weight: 700; }
:root { --ink:#0f172a; --muted:#475569; --blue:#2563eb; --line:#cbd5e1; --warn:#9a3412; }
* { box-sizing: border-box; }
body { margin:0; padding:24px; background:#e2e8f0; color:var(--ink); font-family:'Noto Sans SC','Noto Sans CJK SC','PingFang SC','Microsoft YaHei',sans-serif; }
.toolbar { max-width:794px; margin:0 auto 14px; color:#334155; font-size:13px; }
.sheet { width:794px; min-height:1123px; margin:0 auto; padding:40px 45px 37px; background:#fff; box-shadow:0 12px 32px rgba(15,23,42,.18); position:relative; overflow:hidden; }
h1 { margin:0; font-size:23px; line-height:1.25; font-weight:700; }
.subtitle { margin:3px 0 9px; color:var(--muted); font-size:11px; }
.chip-row { display:flex; flex-wrap:wrap; gap:7px; margin:7px 0 10px; }
.chip { display:inline-block; padding:4px 9px; border:1px solid #c7d2fe; border-radius:5px; background:#eef2ff; color:#334155; font-size:10.5px; line-height:1.2; white-space:nowrap; }
.chip.warn { border-color:#fdba74; background:#ffedd5; color:#9a3412; font-weight:700; }
.chip.ok { border-color:#86efac; background:#f0fdf4; color:#166534; }
h2 { margin:11px 0 5px; padding-left:10px; border-left:4px solid var(--blue); font-size:15px; line-height:1.25; }
.item { margin:0 0 4px 16px; font-size:12px; line-height:1.35; color:#1f2937; }
.item.indent2 { margin-left:24px; }
.item.small { font-size:10.5px; color:#475569; }
.item.bold { font-weight:700; }
.item.warning { color:var(--warn); font-weight:700; }
.section-gap { height:5px; }
.footer-note { position:absolute; left:45px; right:45px; bottom:24px; border-top:1px solid var(--line); padding-top:6px; color:var(--muted); font-size:10.5px; }
.badge { display:inline-block; margin-left:8px; padding:2px 6px; border-radius:4px; background:#f1f5f9; font-size:10px; vertical-align:middle; }
</style>
</head>
<body>
<div class="toolbar">${frozen ? '这是任务冻结内容对应的服务端 HTML 预览；PDF 使用同一内容模型和固定 A4 版式。' : '提交前预览：仅用于确认内容，生成时会再次服务端校验单页容量。'} <strong>不包含地图图像。</strong></div>
<article class="sheet">
  <h1>${esc(model.route.shortTitle)}${model.route.status === 'withdrawn' ? '<span class="badge">路线已撤回</span>' : ''}</h1>
  <div class="subtitle">路线打印卡 · 服务端统一 A4 版式 · 无地图截图</div>
  <div class="chip-row">
    ${chip(`版本 ${model.cardVersion}`)}${chip(`信息日期 ${model.route.infoDate}`)}${chip(`生成日期 ${model.generatedForDate}`)}${chip(model.walking.modeLabel)}${chip(model.route.infoStatus, statusTone)}
  </div>
  ${terrain}

  <h2>起终点与用时</h2>
  ${item(`起点：${model.route.start.name}（${model.route.start.elevation} m）。${model.route.start.note}`)}
  ${item(`终点：${model.route.end.name}（${model.route.end.elevation} m）。${model.route.end.note}`)}
  ${item(`距离 ${model.distance.km} km｜累计上升 ${model.distance.ascentM} m｜下降 ${model.distance.descentM} m`)}
  ${item(`预计用时：${model.walking.text}。${model.walking.basis}`, '', true)}

  <h2>撤出点（完整保留）</h2>
  ${model.route.exits.map(e => item(`撤出点｜${e.name}（${e.distanceKm} km）：${e.routeTo}。${e.note}`)).join('')}

  <h2>注意事项（完整保留）</h2>
  ${model.route.cautions.map(c => item(`注意｜${c}`)).join('')}

  ${model.fields.includes('waypoints') ? `<h2>路点（${model.waypoints.length}/${model.waypointTotal}）</h2>
  ${model.waypoints.length ? model.waypoints.map(wp => item(`${wp.critical ? '关键' : '路点'}｜${wp.name}｜${wp.distanceKm} km｜${wp.elevationM} m${wp.note ? `｜${wp.note}` : ''}`, wp.critical ? '' : 'indent2', wp.critical)).join('') : item('无可用路点。')}` : ''}

  ${model.fields.includes('facilities') ? `<h2>厕所 / 饮水（${model.facilities.length}/${model.facilityTotal}）</h2>
  ${model.facilities.length ? model.facilities.map(f => item(`${f.type === 'toilet' ? '厕所' : '饮水'}｜${f.name}｜${f.location}｜${f.note} ${f.displaySuffix}`, f.stale ? 'warning' : '', f.stale)).join('') : item('无已核对厕所/饮水。')}` : ''}

  ${model.fields.includes('sources') ? `<h2>公开来源（${model.sources.length}/${model.sourceTotal}）</h2>
  ${model.sources.length ? model.sources.map(s => item(`来源｜${s.title}｜${s.publisher}｜取于 ${formatDate(s.retrievedAt)}｜${s.url}`, 'small')).join('') : item('无公开来源。', 'small')}` : ''}

  <h2>摘要与数据说明</h2>
  ${item(`摘要规则：${model.summaryRule.label}。${model.summaryRule.description}`, 'small')}
  ${model.route.infoStatus !== '信息日期已核' ? item(`状态｜${model.route.infoStatus}`, 'warning', true) : ''}
  ${model.omissionNotes.map(n => item(`说明｜${n}`, 'small')).join('')}

  <div class="footer-note">${esc(model.schemaVersion)}｜${esc(model.cardVersion)}｜信息日期 ${esc(model.route.infoDate)}｜生成任务冻结内容，路线更新不会改写此卡</div>
</article>
</body>
</html>`;
}

module.exports = { renderPreviewHtml };
