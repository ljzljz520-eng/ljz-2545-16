const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const path = require('path');

const FONT_REGULAR = path.resolve(
  __dirname,
  '../node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff'
);
const FONT_BOLD = path.resolve(
  __dirname,
  '../node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff'
);

const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  LETTER: { width: 612, height: 792 }
};

const LAYOUT_VERSION = 'route-card-v1.3';
const MARGIN = 30;
const MIN_FONT_SIZE = 9;
const MAX_CARD_TITLE_LENGTH = 18;
const SOURCE_FRESH_DAYS = 180;
const FACILITY_FRESH_DAYS = 365;

const FIELD_SPECS = [
  { key: 'start_end', label: '起点 / 终点', required: true },
  { key: 'exit_points', label: '退出点', required: true },
  { key: 'cautions', label: '注意事项', required: true },
  { key: 'duration', label: '估算用时', required: true },
  { key: 'distance_ascent', label: '里程 / 爬升', required: false },
  { key: 'waypoints', label: '关键拐点', required: false },
  { key: 'facilities', label: '厕所 / 饮水', required: false },
  { key: 'landmarks', label: '导航地标（不含地图）', required: false },
  { key: 'emergency_contacts', label: '应急联系方式', required: false },
  { key: 'transport', label: '往返交通', required: false }
];

const SUMMARY_SPECS = {
  full: {
    label: '完整卡片',
    description: '保留所有已选字段；容量不足时不缩小字体，提交前必须删减或改选规则。'
  },
  key_turns: {
    label: '拐点摘要',
    description: '保留强制安全信息、里程/爬升和关键拐点；折叠地标、交通等辅助字段。'
  },
  safety_minimal: {
    label: '安全最小卡',
    description: '只保留起终点、退出点、注意事项、用时和关键补给；长路线也不静默丢弃核心信息。'
  }
};

const WALKING_MODES = {
  standard: { label: '常规徒步', paceLabel: '常规速度 + 休息' },
  fast: { label: '快走', paceLabel: '快走节奏，短休息' },
  family: { label: '亲子慢行', paceLabel: '亲子/慢速，多休息' }
};

function startOfDay(value) {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

function formatDate(value) {
  if (!value) return '日期缺失';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '日期无效';
  return d.toISOString().slice(0, 10);
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  return [String(value)];
}

function statusOf(record, now = new Date(), freshDays = SOURCE_FRESH_DAYS) {
  if (!record) return { stale: true, pending: true, label: '待确认', age: null };
  const date = record.checked_at || record.info_date || record.observed_at || record.updated_at;
  if (!date) return { stale: true, pending: true, label: '待确认', age: null };
  const age = daysBetween(now, date);
  const stale = age > freshDays;
  return { stale, pending: stale, label: stale ? '待确认' : '已核对', age };
}

function facilityLine(item, now) {
  const type = item.type || '补给点';
  const name = item.name || '未命名点位';
  const location = item.location ? `（${item.location}）` : '';
  const status = statusOf(item, now, FACILITY_FRESH_DAYS);
  const dateText = item.checked_at ? formatDate(item.checked_at) : '未记录核对时间';
  const note = item.note ? `；${item.note}` : '';
  return `${type}：${name}${location}，核对：${dateText}，${status.label}${note}`;
}

function durationLine(route, mode, now) {
  const estimate = route.duration_estimates?.[mode] || {};
  const sourceStatus = statusOf(route.sources?.[0], now, SOURCE_FRESH_DAYS);
  const minutes = estimate.minutes;
  let timeText = '未提供用时';
  if (Number.isFinite(minutes)) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    timeText = h && m ? `${h}小时${m}分` : h ? `${h}小时` : `${m}分钟`;
  }
  const basis = estimate.basis || route.duration_basis || '依据缺失';
  const staleMark = sourceStatus.pending ? '｜整体资料待确认' : '';
  return `${WALKING_MODES[mode]?.label || '徒步'}预计 ${timeText}；依据：${basis}${staleMark}`;
}

function summarizeFacilities(route, mode, now, selected, omitted) {
  const facilities = asArray(route.facilities);
  if (selected.has('facilities')) {
    if (facilities.length === 0) {
      return ['厕所/饮水：当前版本未记录；出发前必须向管理方确认。'];
    }
    if (mode === 'full') return facilities.map((item) => facilityLine(item, now));
    if (mode === 'key_turns') {
      if (!selected.has('facilities')) {
        omitted.push('厕所 / 饮水');
        return [];
      }
      return facilities.slice(0, Math.min(3, facilities.length)).map((item) => facilityLine(item, now));
    }
    const toilet = facilities.find((x) => String(x.type).includes('厕所'));
    const water = facilities.find((x) => String(x.type).includes('饮水'));
    const picked = [toilet, water].filter(Boolean);
    if (picked.length === 0) {
      return ['安全最小补给：未从当前冻结版本识别到厕所或饮水；出发前必须确认。'];
    }
    return picked.map((item) => facilityLine(item, now));
  }
  omitted.push('厕所 / 饮水');
  return [];
}

function applySelection(items, selected, mode, omitted, key, label, options = {}) {
  if (!selected.has(key)) {
    omitted.push(label);
    return [];
  }
  const arr = asArray(items);
  if (mode === 'full') return arr;
  if (mode === 'key_turns') {
    if (!options.keepInKeyTurns) {
      omitted.push(label);
      return [];
    }
    return options.truncate ? arr.slice(0, Math.min(options.truncate, arr.length)) : arr;
  }
  omitted.push(label);
  return [];
}

function buildCardContent(input, options = {}, now = new Date()) {
  const route = input || {};
  const fieldKeys = Array.isArray(options.fields) && options.fields.length
    ? options.fields
    : FIELD_SPECS.filter((f) => f.required).map((f) => f.key);
  const selected = new Set(fieldKeys);
  const mode = SUMMARY_SPECS[options.summaryRule] ? options.summaryRule : 'full';
  const walkingMode = WALKING_MODES[options.walkingMode] ? options.walkingMode : 'standard';
  const pageSize = PAGE_SIZES[options.pageSize] ? options.pageSize : 'A4';
  const omitted = [];
  const errors = [];

  for (const spec of FIELD_SPECS.filter((f) => f.required)) selected.add(spec.key);

  if (!route.short_title && !route.title) errors.push('路线标题缺失');
  if (!asArray(route.start_points).length) errors.push('起点缺失（必需信息不得静默丢弃）');
  if (!asArray(route.end_points).length) errors.push('终点缺失（必需信息不得静默丢弃）');
  if (!asArray(route.exit_points).length) errors.push('退出点缺失（必需信息不得静默丢弃）');
  if (!asArray(route.cautions).length) errors.push('注意事项缺失（必需信息不得静默丢弃）');

  const rawTitle = route.short_title || route.title || '未命名路线';
  const displayTitle = rawTitle.length > MAX_CARD_TITLE_LENGTH
    ? `${rawTitle.slice(0, MAX_CARD_TITLE_LENGTH - 1)}…`
    : rawTitle;

  const source = route.sources?.[0] || {};
  const sourceStatus = statusOf(source, now, SOURCE_FRESH_DAYS);
  const blocks = [];
  const add = (text, style = 'body', indent = false) => {
    if (text === undefined || text === null || text === '') return;
    blocks.push({ text: String(text), style, indent });
  };
  const section = (title) => add(title, 'section');
  const spacer = () => blocks.push({ text: '', style: 'spacer' });

  add(displayTitle, 'title');
  const badges = [
    `路线版本 ${route.version_code || '未记录版本'}`,
    `信息日期 ${formatDate(source.info_date || route.updated_at)}`,
    sourceStatus.pending ? '资料待确认' : '资料在核对期内',
    WALKING_MODES[walkingMode].label,
    pageSize === 'A4' ? 'A4 纵向' : 'Letter 纵向'
  ];
  add(badges.join('  ·  '), 'small');

  section('路线概览');
  add(`路线：${displayTitle}`);
  add(`区域：${route.region || '未记录'}；季节：${route.season || '全年需按天气复核'}`);
  if (selected.has('distance_ascent') || mode === 'key_turns') {
    add(`里程 ${route.distance_km ?? '未记录'} km；累计爬升 ${route.ascent_m ?? '未记录'} m；最高海拔 ${route.max_elevation_m ?? '未记录'} m。`);
  } else {
    omitted.push('里程 / 爬升');
  }

  section('起点 / 终点（必需）');
  asArray(route.start_points).forEach((x, i) => add(`起点${i + 1}：${x}`, 'body', true));
  asArray(route.end_points).forEach((x, i) => add(`终点${i + 1}：${x}`, 'body', true));
  if (selected.has('transport')) {
    add(`交通衔接：起点 ${route.transport?.start_access || '未记录'}；终点 ${route.transport?.end_access || '未记录'}`);
  }

  section('退出点（必需）');
  asArray(route.exit_points).forEach((x, i) => {
    if (typeof x === 'object') {
      add(`退出${i + 1}：${x.name || '未命名'}｜位置：${x.location || '未记录'}｜说明：${x.note || '无'}`, 'body', true);
    } else {
      add(`退出${i + 1}：${x}`, 'body', true);
    }
  });

  section('注意事项（必需）');
  asArray(route.cautions).forEach((x, i) => add(`${i + 1}. ${x}`, 'body', true));

  section('估算用时');
  add(durationLine(route, walkingMode, now), 'body', true);

  if (mode !== 'safety_minimal') {
    const waypoints = applySelection(route.waypoints, selected, mode, omitted, 'waypoints', '关键拐点', { keepInKeyTurns: true, truncate: 8 });
      if (waypoints.length || selected.has('waypoints')) {
      section('关键拐点');
      if (waypoints.length) {
        waypoints.forEach((x, i) => {
          if (typeof x === 'object') {
            add(`${i + 1}. ${x.name || '未命名拐点'}｜${x.instruction || x.description || '无指令'}`, 'body', true);
          } else {
            add(`${i + 1}. ${x}`, 'body', true);
          }
        });
      } else {
        add('当前版本未记录关键拐点；请以现场路标和管理方信息为准。', 'body', true);
      }
    }

    const facilities = summarizeFacilities(route, mode, now, selected, omitted);
    if (facilities.length || selected.has('facilities')) {
      section('厕所 / 饮水');
      if (facilities.length) facilities.forEach((x) => add(x, 'body', true));
      else add('当前版本未记录厕所/饮水；出发前必须向管理方确认。', 'body', true);
    }

    const landmarks = applySelection(route.landmarks, selected, mode, omitted, 'landmarks', '导航地标（不含地图）', { keepInKeyTurns: false });
    if (landmarks.length) {
      section('导航地标（不含地图）');
      landmarks.forEach((x) => add(`· ${x}`, 'body', true));
    }

    const contacts = applySelection(route.emergency_contacts, selected, mode, omitted, 'emergency_contacts', '应急联系方式');
    if (contacts.length) {
      section('应急联系方式');
      contacts.forEach((x) => add(`· ${x}`, 'body', true));
    }

    const transport = applySelection(
      route.transport?.notes,
      selected,
      mode,
      omitted,
      'transport',
      '往返交通'
    );
    if (transport.length) {
      section('往返交通');
      transport.forEach((x) => add(`· ${x}`, 'body', true));
    }
  } else {
    ['waypoints:关键拐点', 'landmarks:导航地标（不含地图）', 'emergency_contacts:应急联系方式', 'transport:往返交通']
      .map((entry) => entry.split(':'))
      .forEach(([key, label]) => { if (selected.has(key)) omitted.push(label); });
    if (selected.has('distance_ascent')) omitted.push('里程 / 爬升');
    const facilities = summarizeFacilities(route, mode, now, new Set(['facilities']), omitted);
    section('安全最小补给');
    facilities.forEach((x) => add(x, 'body', true));
  }

  if (mode !== 'full') {
    spacer();
    const uniqueOmitted = [...new Set(omitted)];
    add(`摘要规则：${SUMMARY_SPECS[mode].label}。${uniqueOmitted.length ? `未展开：${uniqueOmitted.join('、')}。` : '无附加字段被折叠。'}核心安全信息均已保留。`, 'note');
  }

  const sourceLine = `来源：${source.name || '未记录来源'}｜信息日期 ${formatDate(source.info_date)}｜发布/核对 ${formatDate(source.checked_at || source.published_at)}`;
  add(sourceLine, 'small');

  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ route, fields: [...selected], mode, walkingMode, pageSize, generatedAt: options.generatedAt }))
    .digest('hex');

  const layoutParams = {
    layoutVersion: LAYOUT_VERSION,
    pageSize,
    pageSizePt: PAGE_SIZES[pageSize],
    marginPt: MARGIN,
    minFontSizePt: MIN_FONT_SIZE,
    titleMaxChars: MAX_CARD_TITLE_LENGTH,
    walkingMode,
    summaryRule: mode,
    fields: [...selected],
    renderer: 'server-pdfkit',
    contentHash
  };

  return { blocks, omitted: [...new Set(omitted)], errors, layoutParams, displayTitle };
}

function createPdfDoc(pageSize = 'A4') {
  const size = pageSize === 'LETTER' ? 'LETTER' : 'A4';
  const doc = new PDFDocument({
    size,
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: '路线打印卡',
      Author: '路线打印卡服务',
      Subject: '服务端冻结版本的单页徒步路线卡',
      Creator: LAYOUT_VERSION
    }
  });
  doc.registerFont('NotoSansSC', FONT_REGULAR);
  doc.registerFont('NotoSansSC-Bold', FONT_BOLD);
  return doc;
}

const STYLES = {
  title: { font: 'NotoSansSC-Bold', size: 14, leading: 17, gap: 3, color: '#1f2937' },
  section: { font: 'NotoSansSC-Bold', size: 10, leading: 13, gap: 3, color: '#14532d', before: 4 },
  body: { font: 'NotoSansSC', size: 9, leading: 11.2, gap: 0.4, color: '#1f2937' },
  note: { font: 'NotoSansSC', size: 9, leading: 11.2, gap: 0.4, color: '#4b5563' },
  small: { font: 'NotoSansSC', size: 9, leading: 11.2, gap: 0.4, color: '#4b5563' },
  spacer: { height: 4 }
};

function measureContent(content, options = {}) {
  const doc = createPdfDoc(options.pageSize || content.layoutParams.pageSize);
  const page = PAGE_SIZES[content.layoutParams.pageSize];
  const contentWidth = page.width - MARGIN * 2;
  const headerHeight = 46;
  const footerHeight = 24;
  const available = page.height - MARGIN * 2 - headerHeight - footerHeight;
  let bodyHeight = 0;
  const lines = [];

  content.blocks.forEach((block) => {
    const style = STYLES[block.style] || STYLES.body;
    if (block.style === 'spacer') {
      bodyHeight += style.height;
      return;
    }
    const before = style.before || 0;
    doc.font(style.font).fontSize(style.size);
    const h = doc.heightOfString(block.text, { width: contentWidth, lineGap: style.gap });
    bodyHeight += before + h;
    const approx = Math.max(1, Math.ceil(h / (style.size + style.gap)));
    lines.push({ ...block, height: h, lines: approx, before });
  });

  const overflow = Math.max(0, bodyHeight - available);
  const fillRatio = bodyHeight / available;
  doc.end();
  return {
    fits: overflow <= 0 && content.errors.length === 0,
    availableHeightPt: Number(available.toFixed(1)),
    bodyHeightPt: Number(bodyHeight.toFixed(1)),
    overflowHeightPt: Number(overflow.toFixed(1)),
    fillRatio: Number(fillRatio.toFixed(3)),
    minFontSizeUsedPt: MIN_FONT_SIZE,
    lineCount: lines.reduce((sum, x) => sum + x.lines, 0),
    lines,
    requiredErrors: content.errors
  };
}

function renderPdf(content, frozenTask = {}) {
  const pageSize = content.layoutParams.pageSize;
  const doc = createPdfDoc(pageSize);
  const page = PAGE_SIZES[pageSize];
  const width = page.width;
  const yEnd = page.height - MARGIN;
  let overflowed = false;

  // 独立页眉；不输出网站导航、Logo 或任何地图图像。
  doc.rect(0, 0, width, 42).fill('#f0fdf4');
  doc.font('NotoSansSC-Bold').fontSize(11).fillColor('#14532d')
    .text('路线打印卡（服务端冻结版）', MARGIN, 15, { width: width - MARGIN * 2 });
  doc.font('NotoSansSC').fontSize(9).fillColor('#4b5563')
    .text('无地图图像 · 仅文字导航与安全信息', MARGIN, 30, { width: width - MARGIN * 2, align: 'right' });

  let y = 58;
  const x = MARGIN;
  const maxWidth = width - MARGIN * 2;
  const bottomLimit = yEnd - 25;

  const ensure = (h) => {
    if (y + h > bottomLimit) overflowed = true;
  };

  // 单页卡片的硬性约束：禁止 PDFKit 自动追加第二页。
  doc.continueOnNewPage = () => {
    overflowed = true;
    throw new Error('FORCED_SINGLE_PAGE_OVERFLOW');
  };

  content.blocks.forEach((block) => {
    const style = STYLES[block.style] || STYLES.body;
    if (block.style === 'spacer') {
      y += style.height;
      return;
    }
    y += style.before || 0;
    doc.font(style.font).fontSize(style.size).fillColor(style.color);
    const h = doc.heightOfString(block.text, { width: maxWidth, lineGap: style.gap });
    ensure(h);
    if (overflowed) return;
    try {
      doc.text(block.text, x, y, { width: maxWidth, lineGap: style.gap, align: 'left' });
    } catch (err) {
      if (err.message !== 'FORCED_SINGLE_PAGE_OVERFLOW') throw err;
    }
    y += h;
  });

  const infoDate = frozenTask.info_date ? formatDate(frozenTask.info_date) : '见卡片信息日期';
  doc.rect(MARGIN, yEnd - 19, maxWidth, 0.7).fillColor('#d1d5db').fill();
  doc.font('NotoSansSC').fontSize(9).fillColor('#4b5563')
    .text(
      `版本：${frozenTask.route_version_code || '冻结版本'}｜信息日期：${infoDate}｜版式：${LAYOUT_VERSION}｜任务：${frozenTask.task_id || '预览'}`,
      MARGIN,
      yEnd - 14,
      { width: maxWidth }
    );

  if (overflowed) {
    doc.font('NotoSansSC-Bold').fontSize(9).fillColor('#991b1b')
      .text('内容超出单页容量：本 PDF 不得发布，应返回重新选择摘要规则。', MARGIN, yEnd - 34, { width: maxWidth });
  }

  doc.end();
  return { doc, overflowed, pageCount: doc.bufferedPageRange().count };
}

async function renderPdfBuffer(content, frozenTask = {}) {
  const { doc, overflowed } = renderPdf(content, frozenTask);
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), overflowed }));
    doc.on('error', reject);
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

function renderHtmlPreview(content, frozenTask = {}) {
  const body = content.blocks.map((block) => {
    if (block.style === 'spacer') return '<div class="spacer"></div>';
    return `<div class="${escapeHtml(block.style)}">${escapeHtml(block.text)}</div>`;
  }).join('\n');
  const pageSizeClass = content.layoutParams.pageSize === 'LETTER' ? 'letter' : 'a4';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>路线打印卡预览</title>
<style>
@font-face{font-family:'Noto Sans SC Preview';src:url('/fonts/noto-sans-sc-400.woff') format('woff');font-weight:400;}
@font-face{font-family:'Noto Sans SC Preview';src:url('/fonts/noto-sans-sc-700.woff') format('woff');font-weight:700;}
*{box-sizing:border-box} body{margin:0;background:#e5e7eb;padding:24px;color:#1f2937;font-family:'Noto Sans SC Preview','Noto Sans SC',sans-serif;}
.sheet{position:relative;background:#fff;margin:auto;padding:54px 30px 48px;box-shadow:0 10px 30px rgba(0,0,0,.18);overflow:hidden}
.a4{width:794px;min-height:1123px}.letter{width:816px;min-height:1056px}
.banner{position:absolute;top:0;left:0;right:0;height:42px;background:#f0fdf4;padding:12px 30px;border-bottom:1px solid #bbf7d0}
.banner strong{font-size:15px;color:#14532d}.banner span{float:right;font-size:9pt;color:#4b5563}
.content{margin-top:18px}.title{font-size:14pt;line-height:17px;font-weight:700;margin:0 0 4px}.section{font-size:10pt;line-height:13px;font-weight:700;color:#14532d;margin:4px 0 3px}
.body{font-size:9pt;line-height:11.2pt;margin:0 0 .4px}.note,.small{font-size:9pt;line-height:11.2pt;color:#4b5563;margin:0 0 .4px}.spacer{height:4px}.footer{position:absolute;left:30px;right:30px;bottom:22px;border-top:1px solid #d1d5db;padding-top:4px;font-size:9pt;color:#4b5563}
</style>
</head>
<body>
<main class="sheet ${pageSizeClass}">
  <header class="banner"><strong>路线打印卡（服务端冻结版）</strong><span>无地图图像 · 仅文字导航与安全信息</span></header>
  <section class="content">${body}</section>
  <footer class="footer">版本：${escapeHtml(frozenTask.route_version_code || '冻结版本')}｜信息日期：${escapeHtml(frozenTask.info_date ? formatDate(frozenTask.info_date) : '见卡片信息日期')}｜版式：${LAYOUT_VERSION}｜生成任务：${escapeHtml(frozenTask.task_id || '预览')}</footer>
</main>
</body>
</html>`;
}

module.exports = {
  FIELD_SPECS,
  SUMMARY_SPECS,
  WALKING_MODES,
  PAGE_SIZES,
  LAYOUT_VERSION,
  MIN_FONT_SIZE,
  MAX_CARD_TITLE_LENGTH,
  buildCardContent,
  measureContent,
  renderPdf,
  renderPdfBuffer,
  renderHtmlPreview,
  formatDate,
  statusOf
};
