const now = new Date().toISOString();
const recent = new Date(Date.now() - 20 * 86400000).toISOString();
const old = new Date(Date.now() - 400 * 86400000).toISOString();

const routes = [
  {
    title: '云栖湖至青松垭一日环线',
    short_title: '云栖湖环线',
    region: '云雾山北坡',
    distance_km: 12.8,
    ascent_m: 620,
    max_elevation_m: 1180,
    season: '4-11月；雨后湿滑',
    duration_basis: '轨迹均速 2.8 km/h、每 45 分钟休息 8 分钟，已核对路口和补给点',
    duration_estimates: {
      fast: { minutes: 270, basis: '快走均速3.4km/h，两次短休息；按近期轨迹和620m爬升估算' },
      standard: { minutes: 345, basis: '常规2.8km/h、三次10分钟休息；依据2026年9月领队实测轨迹' },
      family: { minutes: 450, basis: '亲子慢行2.1km/h、四次20分钟休息；依据家庭队伍反馈和爬升调整' }
    },
    start_points: ['云栖湖游客中心西侧集合点，有停车场和公厕'],
    end_points: ['原路回到云栖湖游客中心西侧集合点'],
    exit_points: [
      { name: '白石溪下撤口', location: '约4.6km处', note: '接防火道，步行约35分钟到备用停车点' },
      { name: '青松垭南出口', location: '最高点东侧', note: '天气恶化时沿主路下撤，不进入竹林支线' }
    ],
    cautions: [
      '雨后白石溪石阶湿滑，必须使用扶绳并保持一人一石。',
      '16:30后青松垭温度下降快，头灯和防风壳为强制装备。',
      '湖区支流在雨后可能漫过踏石，不要强涉；改走白石溪下撤口。'
    ],
    waypoints: [
      { name: '游客中心后铁门', instruction: '出门后左转进入碎石路，不往露营地方向' },
      { name: '云栖溪小桥', instruction: '过桥后第2个岔路右拐，有红白条路标' },
      { name: '废弃茶棚', instruction: '从棚后石阶上行，沿溪谷左侧走' },
      { name: '白石溪岔口', instruction: '环线继续直行；需退出时右转防火道' },
      { name: '三段坡顶', instruction: '看到通讯塔后横切，勿走左侧机耕道' },
      { name: '青松垭', instruction: '垭口短暂停留，下降路线在东南侧' },
      { name: '竹林平台', instruction: '沿木栈道下行，雨后不跑跳' },
      { name: '湖区围栏缺口', instruction: '穿过缺口后沿围栏外侧回游客中心' }
    ],
    facilities: [
      { type: '厕所', name: '云栖湖游客中心厕所', location: '起点/终点', checked_at: recent },
      { type: '饮水', name: '游客中心直饮机', location: '起点建筑旁', checked_at: recent },
      { type: '厕所', name: '白石溪临时环保厕所', location: '4.6km下撤口', checked_at: old, note: '开放状态需现场确认' },
      { type: '饮水', name: '青松垭补给箱', location: '最高点东侧', checked_at: recent, note: '仅瓶装水，不保证补给' }
    ],
    landmarks: ['溪桥右侧红白路标', '茶棚后方黑色石台阶', '三段坡顶通讯塔', '垭口东南侧红色救援牌'],
    emergency_contacts: ['云雾山救援站 0571-5555-0101（值班电话）', '备用停车点值班室 0571-5555-0202'],
    transport: {
      start_access: '游客中心停车场，周末8:30前有空位',
      end_access: '同起点；末班接驳车17:10',
      notes: ['建议拼车；游客中心停车场周末9:00后可能满位。', '若从白石溪退出，可联系备用停车点接回。']
    },
    sources: [
      { name: '云雾山户外志愿队 2026年9月复核记录', url: 'https://example.org/sources/yunqi-2026-09', info_date: recent, checked_at: recent, published_at: recent, editor: 'private-editor-7', internal_note: '私有复核备注：待补照片，不输出到卡片' }
    ]
  },
  {
    title: '北岭古道到望海亭穿越线（长路线示例）',
    short_title: '北岭古道穿越',
    region: '北岭省级步道',
    distance_km: 21.5,
    ascent_m: 1480,
    max_elevation_m: 1460,
    season: '10月至次年5月；夏季炎热需早出发',
    duration_basis: '传统徒步速度、爬升修正和三次长休息估算；部分补给资料较旧',
    duration_estimates: {
      fast: { minutes: 420, basis: '快走队伍约7小时，依据1480m爬升和成熟路面估算' },
      standard: { minutes: 540, basis: '常规队伍9小时，含三次20分钟休息；依据领队计划和历史轨迹' },
      family: { minutes: 720, basis: '亲子队伍不建议全程，按12小时保守估算；需在第二退出点折返' }
    },
    start_points: ['北岭古道西入口停车场'],
    end_points: ['望海亭东门公交站'],
    exit_points: [
      { name: '半山村出口', location: '7.2km', note: '可约车，商店周末营业' },
      { name: '风车坪公路口', location: '13.8km', note: '最后一个可靠退出点，之后到终点约3小时' }
    ],
    cautions: [
      '全程无遮蔽路段约6km，夏季每人至少携带2L水。',
      '风车坪后手机信号断续，必须结伴并按主路行进。',
      '望海亭下降台阶年久失修，头灯晚到者必须使用。'
    ],
    waypoints: Array.from({ length: 18 }, (_, i) => ({
      name: `长路线拐点 ${i + 1}`,
      instruction: `沿主路通过${i + 1}号路口；此处可能有相似岔路，需核对红白条路标和海拔描述。`
    })),
    facilities: [
      { type: '厕所', name: '西入口公厕', location: '起点', checked_at: recent },
      { type: '饮水', name: '半山村民宿补水点', location: '7.2km', checked_at: old },
      { type: '厕所', name: '风车坪临时厕所', location: '13.8km', checked_at: old },
      { type: '饮水', name: '望海亭补给站', location: '终点前500m', checked_at: recent }
    ],
    landmarks: ['西入口古榕树', '半山村老戏台', '风车坪三号风机', '望海亭石牌坊'],
    emergency_contacts: ['北岭步道救援 0574-5555-0911'],
    transport: {
      start_access: '西入口停车场容量小',
      end_access: '望海亭东门公交站，末班车18:00',
      notes: ['起终点不同，建议提前安排接驳。', '半山村周末可电话约车，但需前一日确认。']
    },
    sources: [
      { name: '北岭步道管理处资料汇编', url: 'https://example.org/sources/beiling-old', info_date: old, checked_at: old, published_at: old, editor: 'editor-b', internal_note: '私有：补给照片已过期' }
    ]
  }
];

module.exports = { routes };
