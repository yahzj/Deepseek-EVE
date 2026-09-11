/**
 * 星系网络（M3 + 星图拓展 v2）：20 星系节点与 27 条航线。
 * 默认坐标为船长本地布局覆盖（编辑器排版版，2026-09-05 从 %APPDATA% 覆盖数据合入，
 * 与此前合入版不一致处一律以本地为准）并整体左移 14（右缘文字不再贴界、左右留空均衡）。
 * 之后仍可在编辑器里拖拽调整（本地覆盖 + 导出坐标 JSON 回传合入）。
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
    x: 140,
    y: 163,
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
    x: 260,
    y: 225,
    security: +0.1,
    description: '一条红色星环横贯星系，劫掠舰队的老巢。',
  },
  {
    id: 'galaxy-grave',
    name: '暗星坟场',
    x: 386,
    y: 193,
    security: -1.0,
    description: '古代舰队的墓园，据说守墓人从不睡觉。',
  },
  {
    id: 'galaxy-abyss',
    name: '深渊之门',
    x: 492,
    y: 268,
    security: -0.7,
    description: '一道古老跃迁门矗立于此，守卫森严——门后是什么没人回来过。',
  },
  {
    id: 'galaxy-auro',
    name: '奥罗荒环',
    x: 493,
    y: 206,
    security: -0.2,
    description: '环状小行星废墟带，旧战争留下的武装残骸在此游荡。',
  },
  {
    id: 'galaxy-starcore',
    name: '星髓迷宫',
    x: 339,
    y: 117,
    security: -0.5,
    description: '高密度星云的迷宫核心区，导航仪在这里都会失灵——只能靠航线图硬闯。',
  },
  {
    id: 'galaxy-harbor',
    name: '新港走廊',
    x: 127,
    y: 72,
    security: +0.6,
    description: '母港外环的补给走廊，商船队与协会巡逻舰的必经之路。',
  },
  {
    id: 'galaxy-haze',
    name: '灰霾带',
    x: 262,
    y: 20,
    security: +0.4,
    description: '常年笼罩电离灰霾，旧航标半数失修。',
  },
  {
    id: 'galaxy-shard',
    name: '碎晶带',
    x: 293,
    y: 75,
    security: +0.2,
    description: '巨型碎裂晶体的漂浮坟场，折射出奇异的虹光。',
  },
  {
    id: 'galaxy-cinder',
    name: '烬火星区',
    // 2026-09-10 船长：往右挪 40（560 → 600）——原位置紧挨「星噬之口」（546,137），
    // 叠加在其上方的「敌对派系活跃」全称标签会被邻居的名称带压住；右移后整组标记（居中不偏移）
    // 有了干净空位，且与「虚海边缘」（660,157）仍留 60 单位的间距
    x: 600,
    y: 170,
    // 2026-09-11 船长（「低安至少要有一个海盗族」+ 「直接将星系互换，安全等级也跟着换」）：
    // 与「蜃影星系」**互换安全等级**（-0.7 → 0.0，由低安降为中安）。理由见下条与
    // docs/design/foe-ship-config-pilot-20260911.md §六：
    // 卡一张不动、名不改（本星系仍是「烬火围攻战 42」，威胁段落在中安顶段 52 之内），
    // **矿带留在原位**（矿带是独立表、按 galaxyId 挂星系，改 security 不动它）。
    security: 0.0,
    description: '一场百年前的星际火灾遗留的暗色灰烬带。',
  },
  {
    id: 'galaxy-echo',
    name: '回音荒区',
    x: 415,
    y: 30,
    security: 0.0,
    description: '无线电在此反复回响，据说能听见沉船的最后呼救。',
  },
  {
    id: 'galaxy-lantern',
    name: '灯塔长廊',
    x: 230,
    y: 139,
    security: +0.4,
    description: '古代导航信标阵列，仍以无人维护的姿态工作。',
  },
  {
    id: 'galaxy-chasm',
    name: '裂谷深带',
    x: 504,
    y: 31,
    security: -0.6,
    description: '行星系撕裂后留下的深谷，引力异常处处可见。',
  },
  {
    id: 'galaxy-mirage',
    name: '蜃影星系',
    // 2026-09-10 船长：微微下移 12（115 → 127）——烬火星区右移后，「碎晶带→烬火星区」这条航线
    // 正好从蜃影星系的圆点里穿过（圆心垂距仅 1.6，圆点半径 8）；下移 12 后垂距 13.0，视觉上让开星点，
    // 与最近邻「暗星坟场」仍留 73 的间距，全图其它航线贴线情况不变
    x: 417,
    y: 127,
    // 2026-09-11 船长（「低安至少要有一个海盗族。目前都处于非低安区」→ 裁决「直接将星系互换，
    // 安全等级也跟着换」「矿带保留在原位」）：本星系改判为**低安**（0.0 → -0.7）。
    //
    // 它持有 A 族「蜃影导航劫持令 48」——A 族六张里威胁最高、且 48 正好贴着低安地板（原最低 42），
    // 是六个海盗星系里最适合进低安的一个。改判后**三条通道同时点亮**：
    //   ① 低安可接的海盗悬赏；② 低安伏击遭遇里出现海盗（伏击者取自该星系可见悬赏敌群，
    //      `encounters.ts`）——且伏击只发生在"停留与就地作业"，**矿带留在原位正是收益所在**：
    //      在这条矿带上采掘就会招来海盗；③ 星图"敌对派系"标签由悬赏卡推导（`Expedition.tsx`），
    //      本星系从此显示「海盗」。
    // 卡 / 卡名 / 星图位置 / 矿带一律未动（与 captain ⑥「先不改数值」一致）。
    security: -0.7,
    description: '强烈引力透镜让群星在这里扭曲成幻景。',
  },
  {
    id: 'galaxy-maw',
    name: '星噬之口',
    x: 546,
    y: 137,
    security: -0.9,
    description: '一条缓慢吞噬星光的巨型裂隙，协会严禁深入腹地。',
  },
  {
    id: 'galaxy-vault',
    name: '穹顶墓园',
    x: 608,
    y: 57,
    security: -1.0,
    description: '古代文明封存舰队的穹顶掩体群，守墓舰队仍在巡弋。',
  },
  {
    id: 'galaxy-nadir',
    name: '天底静区',
    x: 606,
    y: 256,
    security: -0.5,
    description: '银河平面正下方的死寂区，没有任何星体愿意停驻。',
  },
  {
    id: 'galaxy-voidedge',
    name: '虚海边缘',
    x: 660,
    y: 157,
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
