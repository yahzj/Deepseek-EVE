/**
 * 星系网络（M3 + 星图拓展 v2）：20 星系节点与 27 条航线。
 * 默认坐标为船长在游戏内「✎ 布局编辑」手动排版后导出、于 2026-09-04 合入的版本；
 * 之后仍可在编辑器里拖拽调整（本地覆盖 + 导出坐标 JSON 回传合入）。
 * 整体平移：2026-09-05 起布局整体左移 14（穹顶墓园名称原贴右界出界，左缘留空过多）。
 * 引用/可达性守护：运行 tools/content-validate.ts。
 * 母港星系 id 必须等于 core 的 HOME_GALAXY_ID（'galaxy-hub'）。
 */

import type { GalaxyDef, GalaxyEdgeDef } from '@whale/core'

export const GALAXIES: readonly GalaxyDef[] = [
  {
    id: 'galaxy-hub',
    name: '大鲸鱼Ⅳ',
    x: 31,
    y: 54,
    security: +1.0,
    description: '母港星系：深空工业协会总部所在地，所有航线从这里出发。',
  },
  {
    id: 'galaxy-kor',
    name: '柯尔边境',
    x: 198,
    y: 33,
    security: +0.5,
    description: '早期殖民地的残迹，海盗常在这里设伏。',
  },
  {
    id: 'galaxy-dust',
    name: '星尘荒原',
    x: 143,
    y: 266,
    security: +0.6,
    description: '星尘弥漫的废弃采掘区，旧工业平台的坟场。',
  },
  {
    id: 'galaxy-redring',
    name: '红环航道',
    x: 279,
    y: 244,
    security: +0.1,
    description: '一条红色星环横贯星系，劫掠舰队的老巢。',
  },
  {
    id: 'galaxy-grave',
    name: '暗星坟场',
    x: 644,
    y: 272,
    security: -1.0,
    description: '古代舰队的墓园，据说守墓人从不睡觉。',
  },
  {
    id: 'galaxy-abyss',
    name: '深渊之门',
    x: 567,
    y: 245,
    security: -0.7,
    description: '一道古老跃迁门矗立于此，守卫森严——门后是什么没人回来过。',
  },
  {
    id: 'galaxy-auro',
    name: '奥罗荒环',
    x: 396,
    y: 179,
    security: -0.2,
    description: '环状小行星废墟带，旧战争留下的武装残骸在此游荡。',
  },
  {
    id: 'galaxy-starcore',
    name: '星髓迷宫',
    x: 466,
    y: 36,
    security: -0.5,
    description: '高密度星云的迷宫核心区，导航仪在这里都会失灵——只能靠航线图硬闯。',
  },
  {
    id: 'galaxy-harbor',
    name: '新港走廊',
    x: 156,
    y: 67,
    security: +0.6,
    description: '母港外环的补给走廊，商船队与协会巡逻舰的必经之路。',
  },
  {
    id: 'galaxy-haze',
    name: '灰霾带',
    x: 145,
    y: 146,
    security: +0.4,
    description: '常年笼罩电离灰霾，旧航标半数失修。',
  },
  {
    id: 'galaxy-shard',
    name: '碎晶带',
    x: 290,
    y: 109,
    security: +0.2,
    description: '巨型碎裂晶体的漂浮坟场，折射出奇异的虹光。',
  },
  {
    id: 'galaxy-cinder',
    name: '烬火星区',
    x: 560,
    y: 170,
    security: -0.7,
    description: '一场百年前的星际火灾遗留的暗色灰烬带。',
  },
  {
    id: 'galaxy-echo',
    name: '回音荒区',
    x: 337,
    y: 60,
    security: 0.0,
    description: '无线电在此反复回响，据说能听见沉船的最后呼救。',
  },
  {
    id: 'galaxy-lantern',
    name: '灯塔长廊',
    x: 205,
    y: 180,
    security: +0.4,
    description: '古代导航信标阵列，仍以无人维护的姿态工作。',
  },
  {
    id: 'galaxy-chasm',
    name: '裂谷深带',
    x: 535,
    y: 89,
    security: -0.6,
    description: '行星系撕裂后留下的深谷，引力异常处处可见。',
  },
  {
    id: 'galaxy-mirage',
    name: '蜃影星系',
    x: 314,
    y: 164,
    security: 0.0,
    description: '强烈引力透镜让群星在这里扭曲成幻景。',
  },
  {
    id: 'galaxy-maw',
    name: '星噬之口',
    x: 597,
    y: 26,
    security: -0.9,
    description: '一条缓慢吞噬星光的巨型裂隙，协会严禁深入腹地。',
  },
  {
    id: 'galaxy-vault',
    name: '穹顶墓园',
    x: 667,
    y: 41,
    security: -1.0,
    description: '古代文明封存舰队的穹顶掩体群，守墓舰队仍在巡弋。',
  },
  {
    id: 'galaxy-nadir',
    name: '天底静区',
    x: 414,
    y: 94,
    security: -0.5,
    description: '银河平面正下方的死寂区，没有任何星体愿意停驻。',
  },
  {
    id: 'galaxy-voidedge',
    name: '虚海边缘',
    x: 610,
    y: 183,
    security: -0.9,
    description: '可航行宇宙与虚空海的交界，终点就在身后。',
  },
]

/** 航线（无向）：边权 = 单程航程分钟 */
export const GALAXY_EDGES: readonly GalaxyEdgeDef[] = [
  { from: 'galaxy-hub', to: 'galaxy-harbor', travelMinutes: 2 },
  { from: 'galaxy-hub', to: 'galaxy-kor', travelMinutes: 3 },
  { from: 'galaxy-hub', to: 'galaxy-dust', travelMinutes: 5 },
  { from: 'galaxy-kor', to: 'galaxy-shard', travelMinutes: 3 },
  { from: 'galaxy-shard', to: 'galaxy-cinder', travelMinutes: 4 },
  { from: 'galaxy-cinder', to: 'galaxy-redring', travelMinutes: 3 },
  { from: 'galaxy-kor', to: 'galaxy-redring', travelMinutes: 4 },
  { from: 'galaxy-shard', to: 'galaxy-echo', travelMinutes: 6 },
  { from: 'galaxy-echo', to: 'galaxy-nadir', travelMinutes: 7 },
  { from: 'galaxy-kor', to: 'galaxy-starcore', travelMinutes: 7 },
  { from: 'galaxy-starcore', to: 'galaxy-auro', travelMinutes: 5 },
  { from: 'galaxy-auro', to: 'galaxy-redring', travelMinutes: 6 },
  { from: 'galaxy-starcore', to: 'galaxy-chasm', travelMinutes: 6 },
  { from: 'galaxy-chasm', to: 'galaxy-maw', travelMinutes: 5 },
  { from: 'galaxy-cinder', to: 'galaxy-maw', travelMinutes: 7 },
  { from: 'galaxy-maw', to: 'galaxy-vault', travelMinutes: 6 },
  // 船长调整（2026-09-04）：星尘荒原的通路从暗星坟场改为红环航道（玩家布局版本）
  { from: 'galaxy-dust', to: 'galaxy-redring', travelMinutes: 6 },
  { from: 'galaxy-grave', to: 'galaxy-abyss', travelMinutes: 6 },
  { from: 'galaxy-redring', to: 'galaxy-abyss', travelMinutes: 8 },
  { from: 'galaxy-grave', to: 'galaxy-vault', travelMinutes: 5 },
  { from: 'galaxy-vault', to: 'galaxy-voidedge', travelMinutes: 4 },
  { from: 'galaxy-abyss', to: 'galaxy-voidedge', travelMinutes: 6 },
  { from: 'galaxy-harbor', to: 'galaxy-haze', travelMinutes: 4 },
  { from: 'galaxy-haze', to: 'galaxy-lantern', travelMinutes: 5 },
  { from: 'galaxy-dust', to: 'galaxy-lantern', travelMinutes: 4 },
  { from: 'galaxy-auro', to: 'galaxy-mirage', travelMinutes: 5 },
  { from: 'galaxy-mirage', to: 'galaxy-redring', travelMinutes: 4 },
]

/** 构建星系目录 */
export function buildGalaxyCatalog(): ReadonlyMap<string, GalaxyDef> {
  return new Map(GALAXIES.map((g) => [g.id, g]))
}
