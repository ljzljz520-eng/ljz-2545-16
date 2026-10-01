const PDFDocument = require('pdfkit');
const { PAGE, SIZES, FONT_REGULAR, FONT_BOLD, formatDate, wrapText } = require('./layout');

function drawChips(doc, chips, y) {
  const gap = 6;
  let x = PAGE.marginX;
  const h = 15;
  for (const chip of chips) {
    const width = doc.font('NotoSC').fontSize(SIZES.small).widthOfString(chip) + 14;
    if (x + width > PAGE.width - PAGE.marginX && x > PAGE.marginX) {
      x = PAGE.marginX;
      y += h + gap;
    }
    doc.roundedRect(x, y, width, h, 4).fillAndStroke('#eef2ff', '#c7d2fe');
    doc.fillColor('#334155').text(chip, x + 7, y + 3.5, { lineBreak: false });
    x += width + gap;
  }
  return y + h;
}

function drawWrapped(doc, text, x, y, width, opts = {}) {
  const size = opts.size || SIZES.body;
  const font = opts.bold ? 'NotoSC-Bold' : 'NotoSC';
  const color = opts.color || '#1f2937';
  let cursorY = y;
  const lines = wrapText({ width: (t, o) => doc.font(o.bold ? 'NotoSC-Bold' : 'NotoSC').fontSize(o.size).widthOfString(t) }, text, width, { bold: opts.bold, size });
  for (const line of lines) {
    doc.font(font).fontSize(size).fillColor(color).text(line, x, cursorY, { lineBreak: false });
    cursorY += size * 1.32;
  }
  return cursorY;
}

function drawSection(doc, title, y) {
  doc.rect(PAGE.marginX, y + 1.5, 3, 12).fill('#2563eb');
  doc.font('NotoSC-Bold').fontSize(SIZES.sectionTitle).fillColor('#0f172a')
    .text(title, PAGE.marginX + 8, y, { lineBreak: false });
  return y + 19;
}

function renderPdf(model, output) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: { top: PAGE.marginTop, bottom: PAGE.marginBottom, left: PAGE.marginX, right: PAGE.marginX },
    autoFirstPage: true,
    bufferPages: true
  });
  doc.registerFont('NotoSC', FONT_REGULAR);
  doc.registerFont('NotoSC-Bold', FONT_BOLD);

  let y = PAGE.marginTop;
  doc.font('NotoSC-Bold').fontSize(SIZES.title).fillColor('#0f172a')
    .text(model.route.shortTitle, PAGE.marginX, y, { lineBreak: false });
  y += 22;
  doc.font('NotoSC').fontSize(SIZES.small).fillColor('#475569')
    .text('路线打印卡 · 服务端统一 A4 版式 · 无地图截图', PAGE.marginX, y, { lineBreak: false });
  y += 8;

  const chips = [
    `版本 ${model.cardVersion}`,
    `信息日期 ${model.route.infoDate}`,
    `生成日期 ${model.generatedForDate}`,
    model.walking.modeLabel,
    model.route.infoStatus === '信息日期已核' ? '信息日期已核' : '资料待确认'
  ];
  if (model.route.status === 'withdrawn') chips.push('路线已撤回');
  y = drawChips(doc, chips, y) + 10;

  if (model.terrain.length) {
    y = drawChips(doc, model.terrain, y) + 10;
  }

  const x = PAGE.marginX;
  const w = PAGE.contentWidth;

  y = drawSection(doc, '起终点与用时', y);
  y = drawWrapped(doc, `起点：${model.route.start.name}（${model.route.start.elevation} m）。${model.route.start.note}`, x + 12, y, w - 12);
  y += 3;
  y = drawWrapped(doc, `终点：${model.route.end.name}（${model.route.end.elevation} m）。${model.route.end.note}`, x + 12, y, w - 12);
  y += 3;
  y = drawWrapped(doc, `距离 ${model.distance.km} km｜累计上升 ${model.distance.ascentM} m｜下降 ${model.distance.descentM} m`, x + 12, y, w - 12);
  y += 3;
  y = drawWrapped(doc, `预计用时：${model.walking.text}。${model.walking.basis}`, x + 12, y, w - 12, { bold: true });
  y += 8;

  y = drawSection(doc, '撤出点（完整保留）', y);
  for (const exit of model.route.exits) {
    y = drawWrapped(doc, `撤出点｜${exit.name}（${exit.distanceKm} km）：${exit.routeTo}。${exit.note}`, x + 12, y, w - 12);
    y += 3;
  }
  y += 5;

  y = drawSection(doc, '注意事项（完整保留）', y);
  for (const caution of model.route.cautions) {
    y = drawWrapped(doc, `注意｜${caution}`, x + 12, y, w - 12);
    y += 3;
  }
  y += 5;

  if (model.fields.includes('waypoints')) {
    y = drawSection(doc, `路点（${model.waypoints.length}/${model.waypointTotal}）`, y);
    if (!model.waypoints.length) {
      y = drawWrapped(doc, '无可用路点。', x + 12, y, w - 12) + 3;
    }
    for (const wp of model.waypoints) {
      const prefix = wp.critical ? '关键' : '路点';
      y = drawWrapped(doc, `${prefix}｜${wp.name}｜${wp.distanceKm} km｜${wp.elevationM} m${wp.note ? `｜${wp.note}` : ''}`, x + (wp.critical ? 12 : 18), y, w - (wp.critical ? 12 : 18), { bold: wp.critical });
      y += 3;
    }
    y += 5;
  }

  if (model.fields.includes('facilities')) {
    y = drawSection(doc, `厕所 / 饮水（${model.facilities.length}/${model.facilityTotal}）`, y);
    if (!model.facilities.length) {
      y = drawWrapped(doc, '无已核对厕所/饮水。', x + 12, y, w - 12) + 3;
    }
    for (const f of model.facilities) {
      y = drawWrapped(doc, `${f.type === 'toilet' ? '厕所' : '饮水'}｜${f.name}｜${f.location}｜${f.note} ${f.displaySuffix}`, x + 12, y, w - 12, { bold: f.stale, color: f.stale ? '#9a3412' : '#1f2937' });
      y += 3;
    }
    y += 5;
  }

  if (model.fields.includes('sources')) {
    y = drawSection(doc, `公开来源（${model.sources.length}/${model.sourceTotal}）`, y);
    if (!model.sources.length) {
      y = drawWrapped(doc, '无公开来源。', x + 12, y, w - 12, { size: SIZES.small }) + 3;
    }
    for (const s of model.sources) {
      y = drawWrapped(doc, `来源｜${s.title}｜${s.publisher}｜取于 ${formatDate(s.retrievedAt)}｜${s.url}`, x + 12, y, w - 12, { size: SIZES.small });
      y += 3;
    }
    y += 5;
  }

  y = drawSection(doc, '摘要与数据说明', y);
  y = drawWrapped(doc, `摘要规则：${model.summaryRule.label}。${model.summaryRule.description}`, x + 12, y, w - 12, { size: SIZES.small });
  y += 3;
  if (model.route.infoStatus !== '信息日期已核') {
    y = drawWrapped(doc, `状态｜${model.route.infoStatus}`, x + 12, y, w - 12, { bold: true, color: '#9a3412' });
    y += 3;
  }
  for (const note of model.omissionNotes) {
    y = drawWrapped(doc, `说明｜${note}`, x + 12, y, w - 12, { size: SIZES.small, color: '#475569' });
    y += 2;
  }

  const footerY = PAGE.height - PAGE.marginBottom - 18;
  doc.moveTo(PAGE.marginX, footerY - 7).lineTo(PAGE.width - PAGE.marginX, footerY - 7).strokeColor('#cbd5e1').stroke();
  doc.font('NotoSC').fontSize(SIZES.small).fillColor('#475569').text(
    `${model.schemaVersion}｜${model.cardVersion}｜信息日期 ${model.route.infoDate}｜生成任务冻结内容，路线更新不会改写此卡`,
    PAGE.marginX,
    footerY,
    { lineBreak: false, width: PAGE.contentWidth }
  );

  const promise = new Promise((resolve, reject) => {
    doc.on('error', reject);
    if (output && typeof output.on === 'function') {
      output.on('error', reject);
      output.on('finish', resolve);
      doc.pipe(output);
    } else {
      resolve();
    }
  });

  const range = doc.bufferedPageRange();
  if (range.count !== 1) {
    const err = new Error(`PDF 不是单页：${range.count}`);
    if (output && typeof output.destroy === 'function') output.destroy(err);
    return Promise.reject(err);
  }
  doc.end();
  return promise;
}

module.exports = { renderPdf };
