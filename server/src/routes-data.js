const ISO = '2026-09-28';

function waypoint(i, distance, elevation, critical = false, note = '') {
  return {
    id: `wp-${String(i).padStart(2, '0')}`,
    name: `${String(i).padStart(2, '0')}号路桩`,
    distanceKm: Number(distance.toFixed(2)),
    elevationM: elevation,
    critical,
    note
  };
}

const longWaypoints = Array.from({ length: 34 }, (_, idx) => {
  const i = idx + 1;
  const distance = i * 0.48;
  const elevation = Math.round(80 + 420 * Math.sin(i / 4.6) + i * 7.5);
  const turnAt = [6, 12, 19, 25, 31].includes(i);
  return waypoint(
    i,
    distance,
    elevation,
    turnAt,
    turnAt
      ? '岔路按红白路标上行；勿沿防火带下切。'
      : i % 5 === 0
        ? '碎石坡，杖尖需避开松浮边缘。'
        : ''
  );
});

const routeVersions = [
  {
    id: 'rv-lakeside-v2',
    routeId: 'lakeside-loop',
    version: 2,
    shortTitle: '环湖短穿',
    title: '环湖短穿：松林码头至观鸟台',
    status: 'published',
    publishedAt: '2026-09-20T08:30:00+08:00',
    infoDate: '2026-09-25',
    start: { name: '松林码头游客中心', elevation: 72, note: '8:00 开放；闸机右侧集合。' },
    end: { name: '观鸟台北门', elevation: 85, note: '末班接驳 18:30。' },
    distanceKm: 6.4,
    ascentM: 110,
    descentM: 96,
    terrain: ['木栈道', '湖边土路', '少量石阶'],
    exits: [
      { name: '莲池桥撤出点', distanceKm: 2.1, routeTo: '沿莲池西路 25 分钟至 P2 停车场', note: '雨天木桥湿滑。' },
      { name: '芦苇岗亭', distanceKm: 4.3, routeTo: '柏油路 18 分钟可至游客中心', note: '有电话信号。' }
    ],
    cautions: [
      '观鸟台风口不扎营，风级超过 6 级立即从芦苇岗亭撤出。',
      '雨后木栈道湿滑；湖边泥径禁止抄近。',
      '携带至少 1 升水；日落前 40 分钟必须开始下撤。'
    ],
    waypoints: [
      { id: 'wp-01', name: '松林码头入口', distanceKm: 0, elevationM: 72, critical: true, note: '起点签到。' },
      { id: 'wp-02', name: '莲池桥岔口', distanceKm: 2.1, elevationM: 88, critical: true, note: '左转进入湖岸步道。' },
      { id: 'wp-03', name: '观景平台', distanceKm: 3.6, elevationM: 104, critical: false, note: '木栈道窄段。' },
      { id: 'wp-04', name: '芦苇岗亭岔口', distanceKm: 4.3, elevationM: 96, critical: true, note: '紧急撤出点。' },
      { id: 'wp-05', name: '观鸟台北门', distanceKm: 6.4, elevationM: 85, critical: true, note: '终点。' }
    ],
    facilities: [
      { type: 'toilet', name: '松林码头公厕', location: '起点游客中心东侧', checkedAt: '2026-09-24T10:20:00+08:00', note: '两格，含无障碍厕位。' },
      { type: 'water', name: '游客中心直饮水', location: '松林码头游客中心', checkedAt: '2026-09-24T10:20:00+08:00', note: '可接水，建议过滤。' },
      { type: 'toilet', name: '芦苇岗亭移动厕所', location: '4.3 公里岗亭后侧', checkedAt: '2026-03-10T09:00:00+08:00', note: '冬季可能停用。' }
    ],
    sources: [
      { title: '环湖步道维护公告 2026-09', publisher: '湖滨管理处', url: 'https://example.invalid/lakeside/notice-2026-09', retrievedAt: '2026-09-25T15:00:00+08:00' },
      { title: '现场核对记录', publisher: '路线维护员 A-17', url: 'field-note://A17/2026-09-24', retrievedAt: '2026-09-24T11:30:00+08:00' }
    ],
    internalReview: 'PRIVATE: 请勿在公开卡中输出评审分歧。'
  },
  {
    id: 'rv-ridge-v3',
    routeId: 'cloud-ridge-traverse',
    version: 3,
    shortTitle: '云脊大环',
    title: '云脊大环：东门经鹰嘴岩、北风坳至冷杉营地的完整长路线（含五个紧急撤出点）',
    status: 'published',
    publishedAt: '2026-09-26T18:00:00+08:00',
    infoDate: '2026-09-28',
    start: { name: '云脊东门检查站', elevation: 120, note: '需现场登记；6:30 开放。' },
    end: { name: '冷杉营地南口', elevation: 260, note: '预约制营地；到达后向管理员报到。' },
    distanceKm: 16.3,
    ascentM: 1180,
    descentM: 1040,
    terrain: ['根盘陡上', '裸露岩脊', '碎石坡', '冷杉林道'],
    exits: [
      { name: 'E1 青岩亭撤出点', distanceKm: 2.8, routeTo: '石阶 35 分钟至东门停车场', note: '小雨可用。' },
      { name: 'E2 鹰嘴岩南鞍', distanceKm: 5.9, routeTo: '救援径 50 分钟至 P3', note: '雷雨禁用裸露岩脊。' },
      { name: 'E3 北风坳垭口', distanceKm: 9.2, routeTo: '林道 70 分钟至松溪站', note: '风大时优先撤出。' },
      { name: 'E4 双溪桥', distanceKm: 12.4, routeTo: '碎石路 40 分钟至冷杉北口', note: '溪水上涨不可涉渡。' },
      { name: 'E5 旧瞭望塔岔口', distanceKm: 14.6, routeTo: '消防路 55 分钟至南口', note: '夜间路标间距较大。' }
    ],
    cautions: [
      '北风坳 10:00 后常见强风；若风力达 6 级，全队从 E3 北风坳撤出。',
      '鹰嘴岩至南鞍为裸露雷区，听见雷声立即离开山脊，不得在岩檐聚集。',
      '双溪桥水位漫过第二道黑线时停止涉溪，改走 E4 高绕行线并增加 35 分钟。',
      '全程无稳定手机信号；至少两台对讲机，领队与收尾保持每 20 分钟联络。',
      '冷杉营地需预约；未获确认不得把营地当作后备住宿。'
    ],
    waypoints: longWaypoints,
    facilities: [
      { type: 'toilet', name: '东门生态公厕', location: '起点登记站旁', checkedAt: '2026-09-27T08:10:00+08:00', note: '开放，有手纸。' },
      { type: 'water', name: '东门补给点', location: '检查站外侧', checkedAt: '2026-09-27T08:10:00+08:00', note: '直饮水维护中，仅瓶装水售卖。' },
      { type: 'water', name: '青岩亭山溪', location: 'E1 下行 6 分钟', checkedAt: '2025-05-18T12:00:00+08:00', note: '旧记录，旱季可能断流。' },
      { type: 'toilet', name: '北风坳旱厕', location: 'E3 垭口后侧', checkedAt: '2024-11-02T10:30:00+08:00', note: '门栓损坏的旧反馈，需现场确认。' },
      { type: 'water', name: '双溪桥取水点', location: 'E4 桥下 40 米左岸', checkedAt: '2026-09-26T16:45:00+08:00', note: '可过滤取水；雨后浑浊。' },
      { type: 'toilet', name: '冷杉营地厕所', location: '终点营地区 A 区', checkedAt: '2026-09-26T16:45:00+08:00', note: '预约者可用。' }
    ],
    sources: [
      { title: '云脊路线安全公告 v3', publisher: '山地管理中心', url: 'https://example.invalid/ridge/v3', retrievedAt: '2026-09-28T09:00:00+08:00' },
      { title: '北风坳风速记录', publisher: '自动气象站 N-04', url: 'sensor://N-04/2026-09', retrievedAt: '2026-09-28T09:10:00+08:00' },
      { title: '冷杉营地预约规则', publisher: '营地办公室', url: 'https://example.invalid/camp/rules', retrievedAt: '2026-09-27T18:00:00+08:00' },
      { title: '双溪桥水位巡查', publisher: '溪流志愿者队', url: 'field-note://stream/2026-09-26', retrievedAt: '2026-09-26T17:20:00+08:00' },
      { title: '旧版路桩勘误表', publisher: '路线编辑组', url: 'internal:/editors/errata', retrievedAt: '2026-02-01T10:00:00+08:00' }
    ],
    privateEditNotes: '编辑内部字段：候选撤出点尚未复核，绝不允许进入 PDF。'
  },
  {
    id: 'rv-canal-v1',
    routeId: 'canal-history-walk',
    version: 1,
    shortTitle: '运河旧线',
    title: '运河旧线轻步行（已撤回示例）',
    status: 'withdrawn',
    publishedAt: '2025-12-01T09:00:00+08:00',
    infoDate: '2025-11-20',
    withdrawnAt: '2026-08-02T12:00:00+08:00',
    withdrawnReason: '桥洞施工封路，旧版下载链接应显示过期。',
    start: { name: '西码头', elevation: 20, note: '旧集合点。' },
    end: { name: '东水关', elevation: 22, note: '旧终点。' },
    distanceKm: 4.8,
    ascentM: 5,
    descentM: 8,
    terrain: ['平地石板路'],
    exits: [{ name: '博物馆门', distanceKm: 2.4, routeTo: '直接出园', note: '施工期间关闭。' }],
    cautions: ['该版本已撤回，仅供旧任务链接过期验证。'],
    waypoints: [
      { id: 'wp-01', name: '西码头', distanceKm: 0, elevationM: 20, critical: true, note: '' },
      { id: 'wp-02', name: '博物馆门', distanceKm: 2.4, elevationM: 21, critical: true, note: '' },
      { id: 'wp-03', name: '东水关', distanceKm: 4.8, elevationM: 22, critical: true, note: '' }
    ],
    facilities: [],
    sources: [{ title: '旧版路线页', publisher: '编辑组', url: 'internal:/old/canal-v1', retrievedAt: '2025-11-20T10:00:00+08:00' }],
    editorOnly: 'PRIVATE: 撤回原因的内部处理人。'
  }
];

module.exports = { routeVersions, TODAY_ISO: ISO };
