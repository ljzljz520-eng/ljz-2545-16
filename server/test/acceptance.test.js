const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const {
  buildCardModel,
  createPdfMeasurer,
  measureCard,
  SUMMARY_RULES
} = require('../src/layout');
const { renderPdf } = require('../src/render-pdf');
const { renderPreviewHtml } = require('../src/render-html');
const { MemoryStore } = require('../src/store');
const { routeVersions } = require('../src/routes-data');

const allFields = ['terrain', 'waypoints', 'facilities', 'sources'];
const outFile = path.join(__dirname, '..', 'storage', 'acceptance.pdf');

async function renderAndInspect(model) {
  await renderPdf(model, require('fs').createWriteStream(outFile));
  const buffer = await fs.readFile(outFile);
  const parser = new PDFParse({ data: buffer });
  const textResult = await parser.getText();
  const imageResult = await parser.getImage();
  return { buffer, text: textResult.text, images: imageResult };
}

(async () => {
  const ridge = routeVersions.find(route => route.id === 'rv-ridge-v3');
  assert.equal(ridge.status, 'published');

  for (const rule of ['essential', 'landmarks']) {
    const model = buildCardModel(ridge, { walkingMode: 'standard', summaryRule: rule, fields: allFields });
    const estimate = measureCard(model, createPdfMeasurer());
    assert.equal(estimate.fits, true, `${rule} must fit one page`);
    assert.equal(model.layout.page, 'A4');
    assert.equal(model.layout.bodyPt, 9);
    assert.ok(model.layout.bodyPt >= model.layout.minBodyPt);
  }

  const full = buildCardModel(ridge, { walkingMode: 'standard', summaryRule: 'full', fields: allFields });
  const fullEstimate = measureCard(full, createPdfMeasurer());
  assert.equal(fullEstimate.fits, false, 'full long route must be rejected before submission');
  assert.ok(fullEstimate.overflowHeight > 0);

  const essential = buildCardModel(ridge, { walkingMode: 'standard', summaryRule: 'essential', fields: allFields });
  assert.equal(essential.route.exits.length, ridge.exits.length, 'exits must not be summarized away');
  assert.equal(essential.route.cautions.length, ridge.cautions.length, 'cautions must not be summarized away');
  assert.ok(essential.waypoints.length < ridge.waypoints.length, 'ordinary waypoints are explicitly summarized');
  assert.ok(essential.omissionNotes.some(note => note.includes('未列')));
  assert.ok(essential.facilities.some(f => f.stale), 'stale facility must remain visible');
  assert.ok(!essential.facilities.some(f => !f.checkedAt));
  assert.equal(essential.walking.text.length > 0, true);
  assert.match(essential.walking.basis, /估算依据：3\.0 km\/h/);

  const html = renderPreviewHtml(essential, { frozen: true });
  for (const forbidden of ['privateEditNotes', 'PRIVATE', 'internal:', '全站导航', '导航栏']) {
    assert.equal(html.includes(forbidden), false, `preview must not contain ${forbidden}`);
  }
  for (const required of ['版本 RC-3', '信息日期 2026-09-28', '资料待确认', '撤出点', '注意事项']) {
    assert.ok(html.includes(required), `preview must contain ${required}`);
  }

  const inspected = await renderAndInspect(essential);
  assert.equal(inspected.images.total, 1);
  assert.deepEqual(inspected.images.pages[0].images, []);
  for (const required of [
    '环湖短穿' === essential.route.shortTitle ? '' : '云脊东门检查站',
    '冷杉营地南口',
    '撤出点',
    '注意事项',
    '估算依据：3.0 km/h',
    '资料待确认',
    '核对时间：2025-05-18',
    '版本 RC-3',
    '信息日期 2026-09-28'
  ].filter(Boolean)) {
    assert.ok(inspected.text.includes(required), `PDF must contain ${required}`);
  }
  for (const forbidden of ['PRIVATE', 'privateEditNotes', '编辑内部字段', 'internal:/', '全站导航', '导航栏', ridge.title]) {
    assert.equal(inspected.text.includes(forbidden), false, `PDF must not contain ${forbidden}`);
  }
  const raw = inspected.buffer.toString('latin1');
  assert.match(raw, /MediaBox\s*\[\s*0\s+0\s+595\.28\s+841\.89\s*]/);
  assert.ok(raw.includes('/FontFile2'), 'font program must be embedded');
  assert.equal(raw.includes('/Subtype /Image'), false);

  const store = new MemoryStore();
  await store.init();
  const owner = 'owner-acceptance';
  const job = await store.createJob({
    id: '11111111-1111-4111-8111-111111111111',
    ownerKey: owner,
    routeVersionId: ridge.id,
    walkingMode: 'standard',
    fields: allFields,
    summaryRule: 'essential',
    layoutParams: essential.layout,
    frozenContent: essential,
    estimate: measureCard(essential, createPdfMeasurer()),
    sourceRefs: ridge.sources
  });
  const claimed = await store.claimNextQueued();
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.status, 'rendering');
  await store.completeJob(job.id, outFile);
  const recovered = await store.getJob(job.id, owner);
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.frozenContent.cardVersion, 'RC-3');

  await store.withdrawRoute(ridge.id, 'acceptance withdrawal');
  const current = await store.getRoute(ridge.id);
  assert.equal(current.status, 'withdrawn');
  assert.equal(recovered.frozenContent.route.status, 'published', 'frozen content is not rewritten');
  assert.equal(await store.getJob(job.id, 'other-owner'), null, 'jobs are owner scoped');

  console.log('acceptance checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
