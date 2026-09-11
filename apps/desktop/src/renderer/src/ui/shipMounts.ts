/**
 * 舰船战斗图形·挂点元数据（三号 2026-09-10 船长确认方案A：尾焰数量/位置与引擎喷口对齐，
 * 开火点挂在真实炮口；转录自 shipArtData.tsx / shipArt.tsx 各舰 240×110 本地图形几何）。
 *
 * 坐标口径：240×110 画布本地坐标（舰艏朝右，不随 flip 翻转——翻转由渲染层整体镜像）。
 * - engines：引擎喷口"口沿"（舰尾每枚喷口开口左缘中点）；尾焰从该点向左喷出；
 *   无引擎数据（异形有机舰等）→ 不画尾焰。
 * - muzzles：原生炮口端（每门炮管口端；导弹箱取发射口前端中点）；多炮口 = 开火轮换；
 *   无原生炮的船（采矿/货运/重装炮塔朝上类）→ 空表，渲染层回退舰艏前缘锚点。
 * 配套验收文档：docs/design/ship-battle-art/mounts-20260910.md（含逐舰坐标依据与推断说明）。
 */
export interface Pt2 {
  x: number
  y: number
}
export interface ShipMounts {
  engines: Pt2[]
  muzzles: Pt2[]
}

/** 玩家舰 25 艘挂点（key 与 SHIP_ART 一致） */
export const SHIP_MOUNTS: Record<string, ShipMounts> = {
  // ── 掠食者武装族 ──
  // 马鲛级护卫舰（箭头机身+后掠双翼）：双喷口 M46.. 两枚；中置脊炮 M159 43 L190 44 + 机头炮楔形(206..222)
  'sh-shrike': {
    engines: [{ x: 46, y: 50 }, { x: 46, y: 64 }],
    muzzles: [{ x: 190, y: 44 }, { x: 222, y: 58 }],
  },
  // 虎鲨级武装护卫舰（宽身+虎斑斜纹）：双喷口 M48..；脊炮 M163 39 L196 41 + 中后炮 M123 39 L144 40
  'sh-tigershark': {
    engines: [{ x: 48, y: 50 }, { x: 48, y: 66 }],
    muzzles: [{ x: 196, y: 41 }, { x: 144, y: 40 }],
  },
  // 大白鲨级炮舰（流线长身+背鳍）：双喷口 M52..；双联主炮 M210 45 L242 47 / M210 51 L242 53 + 后副炮两门
  'sh-whiteshark': {
    engines: [{ x: 52, y: 51.5 }, { x: 52, y: 65.5 }],
    muzzles: [{ x: 242, y: 47 }, { x: 242, y: 53 }, { x: 196, y: 44 }, { x: 150, y: 44 }],
  },
  // 梭鱼级无人机护卫（机库格口+放飞口）：双喷口 M46..；无原生炮 → 回退舰艏前缘
  'sh-swarm': {
    engines: [{ x: 46, y: 49.5 }, { x: 46, y: 64.5 }],
    muzzles: [],
  },
  // 哨戒级（大平甲板哨戒舰）：四喷口 M48..×2 + M60..×2；舰体无前向炮管 → 回退
  'sh-sentinel': {
    engines: [{ x: 48, y: 50.5 }, { x: 48, y: 62.5 }, { x: 60, y: 50.5 }, { x: 60, y: 62.5 }],
    muzzles: [],
  },
  // 长尾鲨级导弹巡洋舰（背斜导弹箱组）：单喷口 M46..；导弹箱发射口前端(大箱 184~186 / 中箱 152~154 / 前箱 126~128)
  'sh-thresher': {
    engines: [{ x: 46, y: 57 }],
    muzzles: [{ x: 185, y: 30 }, { x: 153, y: 34 }, { x: 127, y: 36 }],
  },
  // 电鳐级激光巡洋舰（扁宽鳐翼+激光束列）：双喷口 M60..；舰艏激光束列 4 发射头(196→222/226 四线)
  'sh-electricray': {
    engines: [{ x: 60, y: 51.5 }, { x: 60, y: 65.5 }],
    muzzles: [{ x: 222, y: 46 }, { x: 222, y: 52 }, { x: 222, y: 58 }, { x: 222, y: 64 }],
  },
  // 牛鲨级突击巡洋舰（撞角装甲首+前置大口径炮）：双喷口 M52..；主炮 M195 45 L226 46
  'sh-bullshark': {
    engines: [{ x: 52, y: 52 }, { x: 52, y: 68 }],
    muzzles: [{ x: 226, y: 46 }],
  },
  // 鲣鱼级护卫舰（机头炮）：单喷口块 M42 50 h10 v10 栅条；机头炮楔形(200..224,57.5~63.5)
  'sh-falconet': {
    engines: [{ x: 42, y: 55 }],
    muzzles: [{ x: 224, y: 60.5 }],
  },
  // 灰鲭鲨级驱逐舰（低趴长身+脊炮×2+上下双引擎；2026-09-09 方向修正定稿）：喷口突唇 M38.. 两枚；
  // 前脊炮 M150 42 L194 42 + 后脊炮 M102 43 L122 44
  'sh-mako': {
    engines: [{ x: 38, y: 50 }, { x: 38, y: 64 }],
    muzzles: [{ x: 194, y: 42 }, { x: 122, y: 43.5 }],
  },
  // 锤头鲨级炮击巡洋舰（锤头装甲首+重炮）：双大喷口 M54..h26 + M62..h26；主炮 M210 51 L246 52 +
  // 左右副炮 M162 47 L196 48 / M162 63 L196 64
  'sh-hammerhead': {
    engines: [{ x: 54, y: 55 }, { x: 62, y: 55 }],
    muzzles: [{ x: 246, y: 52 }, { x: 196, y: 48 }, { x: 196, y: 64 }],
  },
  // ── 甲壳重装族（龟形舰，炮塔短管朝上，无前向炮口 → 回退舰艏前缘） ──
  // 陆龟级（拱壳重装）：单喷口 M60 44 h8 v16
  'sh-tortoise': { engines: [{ x: 60, y: 52 }], muzzles: [] },
  // 玳瑁级（双拱重装）：双喷口 M56 46/63
  'sh-hawksbill': {
    engines: [{ x: 56, y: 53 }, { x: 56, y: 70 }],
    muzzles: [],
  },
  // 玄武级（三层拱甲旗舰）：四喷口 M54..×2 + M66..×2
  'sh-xuanwu': {
    engines: [{ x: 54, y: 50 }, { x: 54, y: 66 }, { x: 66, y: 50 }, { x: 66, y: 66 }],
    muzzles: [],
  },
  // ── 货运族（无原生炮 → 回退舰艏前缘） ──
  // 飞鱼级（流线快船）：双喷口 M60 44/60
  'sh-flyingfish': {
    engines: [{ x: 60, y: 50 }, { x: 60, y: 66 }],
    muzzles: [],
  },
  // 旗鱼级（高背鳍快船）：双喷口 M56 44/61
  'sh-sailfish': {
    engines: [{ x: 56, y: 50.5 }, { x: 56, y: 67.5 }],
    muzzles: [],
  },
  // 剑鱼级（长喙快船）：双喷口 M52 44/61
  'sh-swordfish': {
    engines: [{ x: 52, y: 50.5 }, { x: 52, y: 67.5 }],
    muzzles: [],
  },
  // 蝠鲼级（扁宽翼舱）：双喷口 M60 46/61
  'sh-bowhead': {
    engines: [{ x: 60, y: 51.5 }, { x: 60, y: 66.5 }],
    muzzles: [],
  },
  // 皇带鱼级（超长多舱货舰）：双喷口 M58 46/62
  'sh-colossal': {
    engines: [{ x: 58, y: 52 }, { x: 58, y: 68 }],
    muzzles: [],
  },
  // ── 鲸盟采矿族（钻头在舰艏，无炮 → 回退） ──
  // 沙猫级（单钻）：单喷口 M64 46 h8 v13
  sandcat: { engines: [{ x: 64, y: 52.5 }], muzzles: [] },
  // 掘洞级（双钻）：单喷口 M60 44 h9 v16
  burrower: { engines: [{ x: 60, y: 52 }], muzzles: [] },
  // 鲸吞级（鲸口收集器）：双喷口 M62 44/62
  whale: { engines: [{ x: 62, y: 51 }, { x: 62, y: 69 }], muzzles: [] },
  // 开拓级（三钻横梁）：双喷口 M64 44/61
  pioneer: {
    engines: [{ x: 64, y: 50.5 }, { x: 64, y: 67.5 }],
    muzzles: [],
  },
  // 座头鲸级（驼背矿舰）：双喷口 M62 44/61
  'sh-humpback': {
    engines: [{ x: 62, y: 50.5 }, { x: 62, y: 67.5 }],
    muzzles: [],
  },
  // 鲸王级（巨体矿舰）：四喷口 M58..×2 + M70..×2
  'whale-king': {
    engines: [{ x: 58, y: 50 }, { x: 58, y: 66 }, { x: 70, y: 50 }, { x: 70, y: 66 }],
    muzzles: [],
  },
}

/** 敌族 7 型挂点（key = FOE_FAMILY 族字母，与 FOE_ART 一致） */
export const FOE_MOUNTS: Record<string, ShipMounts> = {
  // A 海盗突击舰（角旗+斜排劫掠炮）：单喷口 M44..；劫掠炮 3 门(斜管口端) + 舰艏短炮 2 门
  A: {
    engines: [{ x: 44, y: 53 }],
    muzzles: [
      { x: 102, y: 52 },
      { x: 130, y: 52 },
      { x: 158, y: 52 },
      { x: 198, y: 60 },
      { x: 196, y: 63 },
    ],
  },
  // B 武装拾荒者：单喷口 M64..；无炮 → 回退
  B: { engines: [{ x: 64, y: 51.5 }], muzzles: [] },
  // C 异形生物舰（有机体，无喷口无炮 → 无尾焰，回退舰艏前缘）
  C: { engines: [], muzzles: [] },
  // D 守墓古舰队（高艉楼+磷光青点）：双喷口 M58..；舰艏炮 M210 54 L230 52
  D: {
    engines: [{ x: 58, y: 50 }, { x: 58, y: 66 }],
    muzzles: [{ x: 230, y: 53 }],
  },
  // E 泰坦级巨构（斜装甲+断口）：双喷口 M60..；舰艏炮口楔(206..218)
  E: {
    engines: [{ x: 60, y: 52 }, { x: 60, y: 68 }],
    muzzles: [{ x: 218, y: 57 }],
  },
  // F 遭遇巡逻舰（制式规整）：双喷口 M62..；舰艏炮楔(206..222)
  F: {
    engines: [{ x: 62, y: 50.5 }, { x: 62, y: 67.5 }],
    muzzles: [{ x: 222, y: 54 }],
  },
  // G 烬火流亡舰队（蜂窝舱+补丁帆）：单喷口 M62 46 h10 v14；舰艏炮楔(204..220)
  G: { engines: [{ x: 62, y: 53 }], muzzles: [{ x: 220, y: 55 }] },
}

/** 取舰/敌族挂点（未收录 → undefined，由调用方回退） */
export function mountsOf(shipId: string | null | undefined, foeKey: string | null | undefined): ShipMounts | undefined {
  if (shipId) return SHIP_MOUNTS[shipId]
  if (foeKey) return FOE_MOUNTS[foeKey]
  return undefined
}
