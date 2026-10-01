const path = require('path');
const PDFDocument = require('pdfkit');
const { TODAY_ISO } = require('./routes-data');

const FONT_DIR = path.join(__dirname, '..', 'node_modules', '@expo-google-fonts', 'noto-sans-sc');
const FONT_REGULAR = path.join(FONT_DIR, '400Regular', 'NotoSansSC_400Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, '700Bold', 'NotoSansSC_700Bold.ttf');

const PAGE = {
  width: 595.28,   // A4 portrait, points
  height: 841.89,
  marginX: 34,
  marginTop: 30,
  marginBottom: 28
};
PAGE.contentWidth = PAGE.width - PAGE.marginX * 2;
PAGE.usableHeight = PAGE.height - PAGE.marginTop - PAGE.marginBottom;

const SIZES = {
  title: 17,
  sectionTitle: 11.5,
  body: 9,
  small: 9,
  lineHeight: 1.32
};
const MIN_BODY_SIZE = 9;

const WALKING_MODES = {
  leisure: {
    label: '轻松步行',
    speedKmh: 2.5,
    ascentMinPer100: 12,
    descentMinPer100: 7,
    basis: '2.5 km/h 平地速度；每 100 m 上升 +12 分钟、每 100 m 下降 +7 分钟'
  },
  standard: {
    label: '常规步行',
    speedKmh: 3.0,
    ascentMinPer100: 10,
    descentMinPer100: 6,
    basis: '3.0 km/h 平地速度；每 100 m 上升 +10 分钟、每 100 m 下降 +6 分钟'
  },
  fast: {
    label: '快速轻装',
    speedKmh: 4.0,
    ascentMinPer100: 8,
    descentMinPer100: 5,
    basis: '4.0 km/h 平地速度；每 100 m 上升 +8 分钟、每 100 m 下降 +5 分钟'
  }
};

const SUMMARY_RULES = {
  essential: {
    label: '关键岔路优先',
    description: '保留关键岔路，最多列 4 条近期厕所/饮水和 2 条来源。',
    maxWaypoints: 0,
    onlyCriticalWaypoints: true,
    maxFacilities: 4,
    maxSources: 2
  },
  landmarks: {
    label: '路标间隔抽样',
    description: '保留关键岔路，并在普通路桩中等距抽样至最多 7 个；最多 6 条设施、4 条来源。',
    maxWaypoints: 7,
    onlyCriticalWaypoints: false,
    maxFacilities: 6,
    maxSources: 4
  },
  full: {
    label: '完整列出',
    description: '完整列出所有允许字段；若仍超过单页容量则拒绝提交，不缩小字号。',
    maxWaypoints: Number.POSITIVE_INFINITY,
    onlyCriticalWaypoints: false,
    maxFacilities: Number.POSITIVE_INFINITY,
    maxSources: Number.POSITIVE_INFINITY
  }
};

const ALLOWED_FIELDS = new Set(['terrain', 'waypoints', 'facilities', 'sources']);
const REQUIRED_SECTIONS = ['startEnd', 'exits', 'cautions'];

function toDate(value) {
  return value ? new Date(value) : null;
}

function daysBetween(laterIso, earlierIso) {
  const later = new Date(`${laterIso}T00:00:00Z`).getTime();
  const earlier = new Date(`${earlierIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((later - earlier) / 86400000);
}

function formatDate(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function minutesToText(minutes) {
  const rounded = Math.max(5, Math.round(minutes / 5) * 5);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分`;
}

function estimateDuration(route, mode) {
  const cfg = WALKING_MODES[mode] || WALKING_MODES.standard;
  const walkingMin = (Number(route.distanceKm) || 0) / cfg.speedKmh * 60;
  const ascentMin = (Number(route.ascentM) || 0) / 100 * cfg.ascentMinPer100;
  const descentMin = (Number(route.descentM) || 0) / 100 * cfg.descentMinPer100;
  const total = walkingMin + ascentMin + descentMin;
  return {
    mode,
    modeLabel: cfg.label,
    text: minutesToText(total),
    minutes: Math.round(total),
    basis: `估算依据：${cfg.basis}；距离 ${route.distanceKm} km、上升 ${route.ascentM} m、下降 ${route.descentM} m。`,
    components: {
      walkingMinutes: Math.round(walkingMin),
      ascentMinutes: Math.round(ascentMin),
      descentMinutes: Math.round(descentMin)
    }
  };
}

function cleanText(value, max = 600) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeRoute(input) {
  const route = {
    id: cleanText(input.id, 80),
    routeId: cleanText(input.routeId, 80),
    version: Number(input.version),
    shortTitle: cleanText(input.shortTitle, 16),
    title: cleanText(input.title, 120),
    status: input.status === 'withdrawn' ? 'withdrawn' : 'published',
    publishedAt: input.publishedAt,
    infoDate: formatDate(input.infoDate || input.publishedAt),
    start: {
      name: cleanText(input.start?.name, 80),
      elevation: Number(input.start?.elevation) || 0,
      note: cleanText(input.start?.note, 180)
    },
    end: {
      name: cleanText(input.end?.name, 80),
      elevation: Number(input.end?.elevation) || 0,
      note: cleanText(input.end?.note, 180)
    },
    distanceKm: Number(input.distanceKm) || 0,
    ascentM: Number(input.ascentM) || 0,
    descentM: Number(input.descentM) || 0,
    terrain: Array.isArray(input.terrain) ? input.terrain.map(v => cleanText(v, 30)).filter(Boolean).slice(0, 8) : [],
    exits: [],
    cautions: [],
    waypoints: [],
    facilities: [],
    sources: []
  };

  route.exits = (Array.isArray(input.exits) ? input.exits : []
  ).map(item => ({
    name: cleanText(item.name, 60),
    distanceKm: Number(item.distanceKm) || 0,
    routeTo: cleanText(item.routeTo, 160),
    note: cleanText(item.note, 160)
  })).filter(item => item.name);

  route.cautions = (Array.isArray(input.cautions) ? input.cautions : [])
    .map(item => cleanText(item, 240))
    .filter(Boolean);

  route.waypoints = (Array.isArray(input.waypoints) ? input.waypoints : []).map((item, index) => ({
    id: cleanText(item.id, 40) || `wp-${index + 1}`,
    name: cleanText(item.name, 60),
    distanceKm: Number(item.distanceKm) || 0,
    elevationM: Number(item.elevationM) || 0,
    critical: Boolean(item.critical),
    note: cleanText(item.note, 160)
  })).filter(item => item.name);

  route.facilities = (Array.isArray(input.facilities) ? input.facilities : [])
    .filter(item => ['toilet', 'water'].includes(item.type))
    .map(item => ({
      type: item.type,
      name: cleanText(item.name, 60),
      location: cleanText(item.location, 100),
      checkedAt: item.checkedAt,
      note: cleanText(item.note, 160)
    }))
    .filter(item => item.name && item.checkedAt);

  route.sources = (Array.isArray(input.sources) ? input.sources : [])
    .filter(item => !String(item.url || '').startsWith('internal:'))
    .map(item => ({
      title: cleanText(item.title, 100),
      publisher: cleanText(item.publisher, 60),
      url: cleanText(item.url, 300),
      retrievedAt: item.retrievedAt
    }))
    .filter(item => item.title && item.publisher);

  return route;
}

function selectWaypoints(waypoints, rule) {
  const critical = waypoints.filter(w => w.critical);
  if (rule.onlyCriticalWaypoints) return critical;
  if (waypoints.length <= rule.maxWaypoints) return waypoints;
  if (!Number.isFinite(rule.maxWaypoints)) return waypoints;

  const selected = new Map(critical.map(w => [w.id, w]));
  const ordinary = waypoints.filter(w => !w.critical);
  const slots = Math.max(0, rule.maxWaypoints - selected.size);
  if (slots > 0 && ordinary.length > 0) {
    for (let i = 0; i < slots; i += 1) {
      const idx = Math.min(ordinary.length - 1, Math.round(i * (ordinary.length - 1) / Math.max(1, slots - 1)));
      selected.set(ordinary[idx].id, ordinary[idx]);
    }
  }
  return waypoints.filter(w => selected.has(w.id));
}

function facilitySuffix(facility) {
  const age = daysBetween(TODAY_ISO, facility.checkedAt);
  const date = formatDate(facility.checkedAt);
  if (age > 180) return `（资料待确认；核对时间：${date}，已 ${age} 天）`;
  return `（核对：${date}）`;
}

function buildCardModel(rawRoute, options = {}) {
  const route = sanitizeRoute(rawRoute);
  const mode = WALKING_MODES[options.walkingMode] ? options.walkingMode : 'standard';
  const ruleId = SUMMARY_RULES[options.summaryRule] ? options.summaryRule : 'essential';
  const rule = SUMMARY_RULES[ruleId];
  const selectedFields = new Set((options.fields || []).filter(f => ALLOWED_FIELDS.has(f)));

  const allWaypoints = route.waypoints;
  const shownWaypoints = selectedFields.has('waypoints') ? selectWaypoints(allWaypoints, rule) : [];
  const freshFacilities = (facilities) => {
    const sorted = facilities.slice().sort((a, b) =>
      new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
    );
    const stale = sorted.filter(f => daysBetween(TODAY_ISO, f.checkedAt) > 180);
    const fresh = sorted.filter(f => daysBetween(TODAY_ISO, f.checkedAt) <= 180);
    // 至少保留一条过期设施，避免把“待确认”状态静默筛掉。
    return stale.length ? fresh.slice(0, 3).concat(stale.slice(0, 1)) : fresh;
  };
  const shownFacilities = selectedFields.has('facilities')
    ? freshFacilities(route.facilities).slice(0, Number.isFinite(rule.maxFacilities) ? rule.maxFacilities : undefined)
    : [];
  const shownSources = selectedFields.has('sources')
    ? route.sources.slice().sort((a, b) => new Date(b.retrievedAt).getTime() - new Date(a.retrievedAt).getTime())
      .slice(0, Number.isFinite(rule.maxSources) ? rule.maxSources : undefined)
    : [];

  const omitted = [];
  if (selectedFields.has('waypoints')) {
    const count = allWaypoints.length - shownWaypoints.length;
    if (count > 0) omitted.push(`${rule.label}：未列 ${count} 个普通路桩/路点`);
  } else {
    omitted.push('路点明细按字段选择未列');
  }
  if (selectedFields.has('facilities')) {
    const count = route.facilities.length - shownFacilities.length;
    if (count > 0) omitted.push(`${count} 条厕所/饮水信息未列`);
  } else {
    omitted.push('厕所/饮水信息按字段选择未列');
  }
  if (selectedFields.has('sources')) {
    const count = route.sources.length - shownSources.length;
    if (count > 0) omitted.push(`${count} 条来源未列`);
  } else {
    omitted.push('来源列表按字段选择未列；原始来源仍冻结在任务记录');
  }
  omitted.push('起点、终点、撤出点和注意事项完整保留，未被摘要规则移除');

  const routeAge = daysBetween(TODAY_ISO, route.infoDate);
  const infoStatus = routeAge > 365 ? '路线信息超过一年，出发前待确认' : '信息日期已核';

  return {
    schemaVersion: 'route-card/v1',
    cardVersion: `RC-${route.version}`,
    generatedForDate: TODAY_ISO,
    route: {
      id: route.id,
      routeId: route.routeId,
      version: route.version,
      shortTitle: route.shortTitle,
      status: route.status,
      infoDate: route.infoDate,
      infoStatus,
      start: route.start,
      end: route.end,
      exits: route.exits,
      cautions: route.cautions
    },
    walking: estimateDuration(route, mode),
    layout: {
      page: 'A4',
      orientation: 'portrait',
      engine: 'pdfkit+noto-sans-sc',
      bodyPt: SIZES.body,
      minBodyPt: MIN_BODY_SIZE,
      font: 'Noto Sans SC embedded',
      marginPt: { left: PAGE.marginX, right: PAGE.marginX, top: PAGE.marginTop, bottom: PAGE.marginBottom }
    },
    fields: Array.from(selectedFields).sort(),
    summaryRule: { id: ruleId, label: rule.label, description: rule.description },
    terrain: selectedFields.has('terrain') ? route.terrain : [],
    distance: { km: route.distanceKm, ascentM: route.ascentM, descentM: route.descentM },
    waypoints: shownWaypoints,
    waypointTotal: allWaypoints.length,
    facilities: shownFacilities.map(f => ({ ...f, displaySuffix: facilitySuffix(f), stale: daysBetween(TODAY_ISO, f.checkedAt) > 180 })),
    facilityTotal: route.facilities.length,
    sources: shownSources,
    sourceTotal: route.sources.length,
    omissionNotes: omitted
  };
}

function createPdfMeasurer() {
  const doc = new PDFDocument({ size: 'A4', margins: { top: PAGE.marginTop, bottom: PAGE.marginBottom, left: PAGE.marginX, right: PAGE.marginX } });
  doc.registerFont('NotoSC', FONT_REGULAR);
  doc.registerFont('NotoSC-Bold', FONT_BOLD);
  return {
    doc,
    fontPaths: { regular: FONT_REGULAR, bold: FONT_BOLD },
    width: (text, { bold = false, size = SIZES.body } = {}) =>
      doc.font(bold ? 'NotoSC-Bold' : 'NotoSC').fontSize(size).widthOfString(String(text ?? ''))
  };
}

function wrapText(measurer, text, width, { bold = false, size = SIZES.body } = {}) {
  const paragraphs = String(text ?? '').split(/\n/);
  const lines = [];
  for (const paragraph of paragraphs) {
    let line = '';
    for (const ch of paragraph) {
      const candidate = line + ch;
      if (line && measurer.width(candidate, { bold, size }) > width) {
        lines.push(line);
        line = ch;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

function textHeight(measurer, text, width, indent = 0, opts = {}) {
  const size = opts.size || SIZES.body;
  return wrapText(measurer, text, width - indent, opts).length * size * SIZES.lineHeight;
}

function chipRows(measurer, chips, width) {
  const gap = 6;
  const rows = [[]];
  let used = 0;
  for (const chip of chips) {
    const chipWidth = measurer.width(chip, { size: SIZES.small }) + 14;
    if (used > 0 && used + gap + chipWidth > width) {
      rows.push([chip]);
      used = chipWidth;
    } else {
      rows[rows.length - 1].push(chip);
      used += (used ? gap : 0) + chipWidth;
    }
  }
  return rows;
}

function measureCard(model, measurer) {
  const width = PAGE.contentWidth;
  let h = 30; // title block
  const chips = [
    `版本 ${model.cardVersion}`,
    `信息日期 ${model.route.infoDate}`,
    `生成日期 ${model.generatedForDate}`,
    model.walking.modeLabel
  ];
  if (model.route.status === 'withdrawn') chips.push('路线已撤回');
  h += chipRows(measurer, chips, width).length * 18 + 8;

  if (model.terrain.length) {
    h += chipRows(measurer, model.terrain, width).length * 18 + 8;
  }

  function sectionTitle() { h += 19; }
  function item(text, indent = 12, opts = {}) {
    h += textHeight(measurer, text, width, indent, opts) + 3;
  }

  sectionTitle();
  item(`起点：${model.route.start.name}（${model.route.start.elevation} m）。${model.route.start.note}`);
  item(`终点：${model.route.end.name}（${model.route.end.elevation} m）。${model.route.end.note}`);
  item(`距离 ${model.distance.km} km｜累计上升 ${model.distance.ascentM} m｜下降 ${model.distance.descentM} m`);
  item(`预计用时：${model.walking.text}。${model.walking.basis}`, 12, { bold: true });
  h += 5;

  sectionTitle();
  for (const exit of model.route.exits) {
    item(`撤出点｜${exit.name}（${exit.distanceKm} km）：${exit.routeTo}。${exit.note}`);
  }
  h += 5;

  sectionTitle();
  for (const caution of model.route.cautions) item(`注意｜${caution}`);
  h += 5;

  if (model.fields.includes('waypoints')) {
    sectionTitle();
    if (model.waypoints.length === 0) item('无可用路点。');
    for (const wp of model.waypoints) {
      item(`${wp.critical ? '关键' : '路点'}｜${wp.name}｜${wp.distanceKm} km｜${wp.elevationM} m${wp.note ? `｜${wp.note}` : ''}`, wp.critical ? 12 : 18, { bold: wp.critical });
    }
    h += 5;
  }

  if (model.fields.includes('facilities')) {
    sectionTitle();
    if (model.facilities.length === 0) item('无已核对厕所/饮水。');
    for (const f of model.facilities) {
      item(`${f.type === 'toilet' ? '厕所' : '饮水'}｜${f.name}｜${f.location}｜${f.note} ${f.displaySuffix}`, 12, { bold: f.stale });
    }
    h += 5;
  }

  if (model.fields.includes('sources')) {
    sectionTitle();
    if (model.sources.length === 0) item('无公开来源。');
    for (const s of model.sources) {
      item(`来源｜${s.title}｜${s.publisher}｜取于 ${formatDate(s.retrievedAt)}｜${s.url}`, 12, { size: SIZES.small });
    }
    h += 5;
  }

  sectionTitle();
  item(`摘要规则：${model.summaryRule.label}。${model.summaryRule.description}`);
  if (model.route.infoStatus !== '信息日期已核') item(`状态｜${model.route.infoStatus}`, 12, { bold: true });
  for (const note of model.omissionNotes) item(`说明｜${note}`, 12, { size: SIZES.small });
  h += 24; // footer allowance

  return {
    fits: h <= PAGE.usableHeight,
    usedHeight: Math.round(h * 10) / 10,
    maxHeight: Math.round(PAGE.usableHeight * 10) / 10,
    overflowHeight: Math.round(Math.max(0, h - PAGE.usableHeight) * 10) / 10,
    page: PAGE,
    sizes: SIZES
  };
}

module.exports = {
  PAGE,
  SIZES,
  FONT_REGULAR,
  FONT_BOLD,
  WALKING_MODES,
  SUMMARY_RULES,
  ALLOWED_FIELDS: Array.from(ALLOWED_FIELDS),
  REQUIRED_SECTIONS,
  sanitizeRoute,
  buildCardModel,
  createPdfMeasurer,
  measureCard,
  wrapText,
  facilitySuffix,
  estimateDuration,
  formatDate
};
