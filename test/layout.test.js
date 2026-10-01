const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCardContent, measureContent, renderPdfBuffer, MIN_FONT_SIZE } = require('../src/layout');
const { routes } = require('../src/db/seed');

function freshRoute(index = 0, overrides = {}) {
  return JSON.parse(JSON.stringify({ ...routes[index], version_code: 'v1.0-test', ...overrides }));
}

test('完整短路线可在 A4 单页内容纳且字体不低于 9pt', () => {
  const content = buildCardContent(freshRoute(0), {
    fields: ['distance_ascent', 'waypoints', 'facilities', 'landmarks', 'emergency_contacts', 'transport'],
    summaryRule: 'full',
    walkingMode: 'standard',
    pageSize: 'A4'
  });
  const estimate = measureContent(content);
  assert.equal(estimate.requiredErrors.length, 0);
  assert.equal(estimate.fits, true);
  assert.equal(estimate.minFontSizeUsedPt, MIN_FONT_SIZE);
  const text = content.blocks.map((b) => b.text).join('\n');
  assert.match(text, /起点 \/ 终点（必需）/);
  assert.match(text, /退出点（必需）/);
  assert.match(text, /注意事项（必需）/);
  assert.match(text, /核对：/);
  assert.match(text, /依据：/);
  assert.match(text, /路线版本 v1\.0-test/);
});

test('过期厕所与饮水保留并显示待确认，而不是静默删除', () => {
  const content = buildCardContent(freshRoute(0), {
    fields: ['facilities'],
    summaryRule: 'full'
  });
  const text = content.blocks.map((b) => b.text).join('\n');
  assert.match(text, /白石溪临时环保厕所/);
  assert.match(text, /待确认/);
});

test('长路线完整规则溢出；拐点摘要明确列出折叠内容后可容纳', () => {
  const full = buildCardContent(freshRoute(1), {
    fields: ['distance_ascent', 'waypoints', 'facilities', 'landmarks', 'emergency_contacts', 'transport'],
    summaryRule: 'full'
  });
  assert.equal(measureContent(full).fits, false);

  const summary = buildCardContent(freshRoute(1), {
    fields: ['distance_ascent', 'waypoints', 'facilities', 'landmarks', 'emergency_contacts', 'transport'],
    summaryRule: 'key_turns'
  });
  const estimate = measureContent(summary);
  assert.equal(estimate.fits, true);
  const text = summary.blocks.map((b) => b.text).join('\n');
  assert.match(text, /摘要规则：拐点摘要/);
  assert.match(text, /未展开：/);
  assert.match(text, /退出点（必需）/);
  assert.match(text, /注意事项（必需）/);
});

test('安全最小卡仍保留强制起终点、退出点、注意事项和关键补给', () => {
  const content = buildCardContent(freshRoute(1), { summaryRule: 'safety_minimal' });
  const estimate = measureContent(content);
  assert.equal(estimate.requiredErrors.length, 0);
  assert.equal(estimate.fits, true);
  const text = content.blocks.map((b) => b.text).join('\n');
  assert.match(text, /起点1/);
  assert.match(text, /终点1/);
  assert.match(text, /退出1/);
  assert.match(text, /1\. 全程无遮蔽/);
  assert.match(text, /安全最小补给/);
});

test('长标题只在卡片中使用截断短标题，完整标题不进入 PDF 文本块', () => {
  const route = freshRoute(0, {
    short_title: '这是一个超过十八个汉字的非常漫长路线标题必须截断',
    title: '这是一个超过十八个汉字的非常漫长路线标题必须截断（完整内部标题）'
  });
  const content = buildCardContent(route, { summaryRule: 'safety_minimal' });
  assert.equal(content.displayTitle.endsWith('…'), true);
  const text = content.blocks.map((b) => b.text).join('\n');
  assert.match(text, /这是一个超过十八个汉字的非常漫长路…/);
  assert.equal(text.includes('完整内部标题'), false);
});

test('PDF 是单页、不含地图图像标记，且不输出私有编辑字段', async () => {
  const route = freshRoute(0);
  route.sources[0].internal_note = 'PRIVATE-EDITOR-NOTE-123';
  const content = buildCardContent(route, { fields: ['facilities'] });
  const { buffer, overflowed } = await renderPdfBuffer(content, {
    task_id: 'test-task',
    route_version_code: 'v1.0-test',
    info_date: new Date().toISOString()
  });
  assert.equal(overflowed, false);
  assert.equal(buffer.indexOf(Buffer.from('/Subtype /Image')), -1);
  assert.equal(buffer.indexOf(Buffer.from('/XObject')), -1);
  assert.notEqual(buffer.indexOf(Buffer.from('/FontFile')), -1);
  assert.equal(buffer.includes(Buffer.from('PRIVATE-EDITOR-NOTE-123')), false);
  assert.equal(buffer.includes(Buffer.from('private-editor')), false);
  // PDFKit 文档仅有一页；以 /Type /Page 出现且无 /Type /Pages 误判：检查线性化对象标题不稳定，至少确保没有第二页 MediaBox。
  const mediaBoxCount = buffer.toString('latin1').match(/\/MediaBox/g) || [];
  assert.equal(mediaBoxCount.length, 1);
});
