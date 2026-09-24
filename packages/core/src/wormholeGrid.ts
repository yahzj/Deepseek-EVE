/**
 * **终局玩法「虫洞」· 层内网格探索（F3a · 2026-09-13 船长确认）**。
 *
 * 船长口径（原话要点，见设计稿 §十一）：
 * - **探索采用网格地图**，整体**呈圆型**；玩家**随机出现在一个入口**；**下一层入口在随机位置**；
 * - **靠扫描获取周围信号**：残骸 / 舰船 / 资源 / 雷达四类；**只有到达后才知道确切信息**，否则只显示信号；
 * - **可前往任意位置（含未扫描）**，但前往未扫描点要**警告玩家**；
 * - **初始扫描范围 1 格**（可依靠其他方式增加）；
 * - **空地点（什么都没有）至少占 50%**；**遗迹概率 30%**（残骸信号的两支：舰船墓场 70% / 遗迹 30%）；
 * - 回合：**扫描 1 · 移动 1 · 激活 1**；**谜质效果挂起**（本批只出地点与物品，不接增强）。
 *
 * 本文件只做**纯几何 + 确定性生成 + 信号遮蔽**（可单测、可存档），
 * 不碰回合扣费与战斗触发（那两块在 `wormhole.ts` / F3b）。
 */
import type { WormholeFoeKind } from './wormholeFoes'
import type { WormholeArchetype } from './state'

/* ═══════════ 一、六边形网格几何（轴向坐标 q/r） ═══════════ */

/** 轴向坐标的一格（`|q|,|r|,|q+r|` 三个数的最大值 = 到中心的六边形距离） */
export interface HexCell {
  q: number
  r: number
}

/** 格的稳定键（存档用字符串；**不要**用对象做键） */
export function hexKey(q: number, r: number): string {
  return `${q},${r}`
}

/** 解析键（坏值 ⇒ null） */
export function parseHexKey(key: string): HexCell | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key)
  if (!m) return null
  return { q: Number(m[1]), r: Number(m[2]) }
}

/** 六边形距离（= 需要几步走到；盘 = 到中心距离 ≤ 半径） */
export function hexDistance(a: HexCell, b: HexCell): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

/** 轴向坐标的 6 个邻居方向（顺序固定，便于确定性生成与测试） */
export const HEX_DIRS: readonly HexCell[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

/** 某格的 6 个邻居（按 `HEX_DIRS` 顺序） */
export function hexNeighbors(cell: HexCell): HexCell[] {
  return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }))
}

/** 半径 R 的**圆盘**全部格（行优先：r 从 -R 到 R，q 从 -R 到 R；共 `3R(R+1)+1` 格） */
export function hexDiskCells(radius: number): HexCell[] {
  const R = Math.max(0, Math.floor(radius))
  const out: HexCell[] = []
  for (let r = -R; r <= R; r++) {
    const qLo = Math.max(-R, -r - R)
    const qHi = Math.min(R, -r + R)
    for (let q = qLo; q <= qHi; q++) out.push({ q, r })
  }
  return out
}

/** 半径 R 盘内的格数（= `hexDiskCells(R).length`，公式口径便于断言） */
export function hexDiskCount(radius: number): number {
  const R = Math.max(0, Math.floor(radius))
  return 3 * R * (R + 1) + 1
}

/** 以 `center` 为中心、半径 `radius` 内（**含中心**）的全部格 */
export function hexDiskAround(center: HexCell, radius: number): HexCell[] {
  return hexDiskCells(radius).map((c) => ({ q: c.q + center.q, r: c.r + center.r }))
}

/** **只取一圈**（到中心距离恰为 `radius`；`radius=0` ⇒ 只有中心格） */
export function hexRingAround(center: HexCell, radius: number): HexCell[] {
  const R = Math.max(0, Math.floor(radius))
  if (R === 0) return [{ q: center.q, r: center.r }]
  return hexDiskAround(center, R).filter((c) => hexDistance(c, center) === R)
}

/** 立方坐标取整（`s = -q - r`；**把误差最大的那一维回拉** ⇒ 落点唯一、不掷骰） */
function cubeRound(q: number, r: number): HexCell {
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(s)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return { q: rq, r: rr }
}

/**
 * **六边形直线**：`a → b` 这条线上依次经过的格（**含两端**）。
 *
 * 用途（船长 2026-09-16「路径拦截」）：判断"从当前格前往目标格"的**直线路径**上有没有敌人挡路。
 *
 * 三条口径：
 * ① **含两端**（`a` 与 `b` 都在结果里；**拦截判定自己把两端排除**——起点是自己站的格、
 *    终点若本身是敌人走的是既有的"到达即开打"）；
 * ② **双向同集**：先把方向规范化（按 `(q, r)` 字典序取小端当起点）再画线 ⇒
 *    `hexLine(a,b)` 与 `hexLine(b,a)` **互为倒序**（同一批格）。否则偶数距离的平局会让
 *    "谁拦谁"随调用方向漂；
 * ③ **平局确定性**：立方坐标取整 ⇒ 同输入恒同输出、**不消耗 `state.rng`**（可复现）。
 *
 * ⚠ 相邻两格必是邻居（步长 1）、共 `hexDistance(a,b) + 1` 格——用例在盘内**逐对**钉住这两条。
 */
export function hexLine(a: HexCell, b: HexCell): HexCell[] {
  const swap = a.q > b.q || (a.q === b.q && a.r > b.r)
  const from = swap ? b : a
  const to = swap ? a : b
  const n = hexDistance(from, to)
  if (n === 0) return [{ q: from.q, r: from.r }]
  const fq = from.q
  const fr = from.r
  const tq = to.q
  const tr = to.r
  const out: HexCell[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    out.push(cubeRound(fq + (tq - fq) * t, fr + (tr - fr) * t))
  }
  return swap ? out.reverse() : out
}

/* ═══════════ 二、信号与地点（信号遮蔽真相） ═══════════ */

/**
 * **扫描能看到的东西**（五类信号；未扫描 = 未知）。
 *
 * ⚠ 2026-09-13 船长追加第五类「**信标信号**」：「新增一个信标信号，到达后有一个漂浮信标，
 * 会告诉玩家终点位置。」⇒ 它是**导航手段**：给"入口在下潜点随机位置、默认不标出来"这条口径
 * 配一个玩家能主动找到的指路环节（找到信标 ⇒ 地图上标出下一层入口）。
 */
export type WormholeSignal = 'wreck' | 'ship' | 'resource' | 'radar' | 'beacon'

/** **到达后才知道的真相**：空地点 / 舰船墓场 / 遗迹 / 舰船 / 矿脉 / 谜质 / 漂浮信标 */
export type WormholePlace = 'empty' | 'graveyard' | 'ruins' | 'ship' | 'vein' | 'matter' | 'beacon'

/**
 * 各类信号的权重（**已扣除空地点**后的相对权重；船长确认：空 ≥50%、遗迹 30%）。
 *
 * ⚠ 2026-09-13 F3a-3 加入信标后重新分配（原来 舰船 30 / 残骸 30 / 资源 25 / 雷达 15）：
 * 信标取 **10**，其余等比例小幅让位。**实测分布**（400 盘/档，`_` 探针跑完即删）：
 * 层 1（R=2，19 格）空 57.9% · 信标 **1.0 个/盘**；层 3（R=3，37 格）空 54.1% · 信标 **1.0 个/盘**；
 * 层 5（R=4，61 格）空 52.5% · 信标 **3.0 个/盘**；三档"遗迹 ÷ 残骸信号"分别 30.4% / 29.8% / 29.7%。
 * 因为格子少 + 最大余数法取整，信标数实际是**定额**（R=2/3 各 1 个、R=4 得 3 个）——
 * 即"每层都有指路信标"，但它在 19~61 格里落在哪一格仍要靠找。
 */
export const WORMHOLE_SIGNAL_WEIGHTS: Readonly<Record<WormholeSignal, number>> = {
  ship: 28,
  wreck: 28,
  resource: 22,
  radar: 12,
  beacon: 10,
}

/* ═══════════ 内容原型（丙 · 船长 2026-09-14 定案：只改"口味"，不动强度曲线） ═══════════ */

/** 五档原型（顺序 = 抽取顺序；content:check 与 save 清洗都用它做白名单） */
export const WORMHOLE_ARCHETYPES: readonly WormholeArchetype[] = ['balanced', 'wreck', 'ruins', 'vein', 'combat']

/** 五档原型的**抽取权重**（船长定案：均衡占大头 40，交火最少 10） */
export const WORMHOLE_ARCHETYPE_WEIGHTS: Readonly<Record<WormholeArchetype, number>> = {
  balanced: 40,
  wreck: 20,
  ruins: 15,
  vein: 15,
  combat: 10,
}

/** 原型中文名（界面徽标/悬停/日志用；正式术语见 `docs/glossary.md`） */
export const WORMHOLE_ARCHETYPE_LABELS: Readonly<Record<WormholeArchetype, string>> = {
  balanced: '均衡深区',
  wreck: '残骸富集',
  ruins: '遗迹密集',
  vein: '母矿脉',
  combat: '交火密集',
}

/** 原型抽取顺序（与权重表同序；抽签与遍历共用，防两处漂移） */
const ARCHETYPE_ORDER: readonly WormholeArchetype[] = ['balanced', 'wreck', 'ruins', 'vein', 'combat']

/**
 * **一处虫洞的内容原型**（确定性：同 `seed` 必得同原型）。
 *
 * 口径 = 按 `WORMHOLE_ARCHETYPE_WEIGHTS` 把 `[0, total)` 切成五段，用种子的确定性散列落段
 * （与 `wormholeStream` 同一套写法）⇒ 老档没有该字段时**现算**也永远一致、不重掷。
 */
export function wormholeArchetypeOf(seed: number): WormholeArchetype {
  let total = 0
  for (const k of ARCHETYPE_ORDER) total += WORMHOLE_ARCHETYPE_WEIGHTS[k]
  const r = wormholeStream(seed * 2654435761 + 17)() * total
  let acc = 0
  for (const k of ARCHETYPE_ORDER) {
    acc += WORMHOLE_ARCHETYPE_WEIGHTS[k]
    if (r < acc) return k
  }
  return 'balanced'
}

/**
 * **原型 → 该层的信号权重表**（在基准表上重分配；**总和保持不变** ⇒ 空占比与"每格价值"都不被放大）。
 *
 * - `wreck`：残骸信号 ×2（墓场/遗迹都算残骸信号 ⇒ 遗迹也随之变多）；
 * - `ruins`：残骸信号 ×1.4，**且**遗迹占比另按 `wormholeRuinsShareFor` 上调（30% → 50%）；
 * - `vein` / `combat`：矿脉 / 舰船信号各放大（×2.2 / ×2）；
 * - 信标恒 10（它是导航件，不参与"口味"）；
 * - 归一化回基准总和并取一位小数（最后一项补差）⇒ 只改配比、不改总量。
 */
export function wormholeSignalWeightsFor(archetype: WormholeArchetype): Readonly<Record<WormholeSignal, number>> {
  const base = WORMHOLE_SIGNAL_WEIGHTS
  const mul: Record<WormholeSignal, number> =
    archetype === 'wreck'
      ? { ship: 1, wreck: 2, resource: 1, radar: 1, beacon: 1 }
      : archetype === 'ruins'
        ? { ship: 1, wreck: 1.4, resource: 1, radar: 1, beacon: 1 }
        : archetype === 'vein'
          ? { ship: 1, wreck: 1, resource: 2.2, radar: 1, beacon: 1 }
          : archetype === 'combat'
            ? { ship: 2, wreck: 1, resource: 1, radar: 1, beacon: 1 }
            : { ship: 1, wreck: 1, resource: 1, radar: 1, beacon: 1 }
  /**
   * ⚠ **信标原样保留**（= 10）——它是每层唯一的指路件，不参与"口味"。
   * 归一化只在**其余四类**里做（压回 `总和 − 10`）⇒
   *  ① 信标的权重/份额/取整与改动前**逐格一致**（信标数不会因原型漂移）；
   *  ② 四类总和也不变（= 90）⇒ 空占比与"每格价值"照旧。
   */
  const keys: WormholeSignal[] = ['ship', 'wreck', 'resource', 'radar']
  const raw = keys.map((k) => base[k] * mul[k])
  const rawTotal = raw.reduce((s, v) => s + v, 0)
  const target = base.ship + base.wreck + base.resource + base.radar
  const out = { ...base } as Record<WormholeSignal, number>
  let used = 0
  keys.forEach((k, i) => {
    if (i === keys.length - 1) {
      out[k] = Math.max(0, Math.round((target - used) * 10) / 10)
      return
    }
    const v = Math.max(0, Math.round((raw[i]! / rawTotal) * target * 10) / 10)
    out[k] = v
    used += v
  })
  return out
}

/** 遗迹占**残骸信号**的比例（基准 30%；`ruins` 原型上调到 50%） */
export function wormholeRuinsShareFor(archetype: WormholeArchetype): number {
  return archetype === 'ruins' ? 0.5 : WORMHOLE_RUINS_SHARE
}

/** 遗迹下限的**原型加成**（`ruins` 原型每层 +1） */
export function wormholeRuinsFloorBonusFor(archetype: WormholeArchetype): number {
  return archetype === 'ruins' ? 1 : 0
}

/** **空地点占比下限**（船长：「添加空信息地点（目标地点什么都没有）至少要占 50%」） */
export const WORMHOLE_EMPTY_MIN_SHARE = 0.5

/**
 * **空地点占比随层下降**（船长 2026-09-13：「**空地块允许随着高层权重降低**」）。
 *
 * 为什么必须放开它：`空 ≥ 50%` 是一道**硬夹子**——非空格数 = 可分配池 − 空格数，
 * 遗迹/舰船/矿脉**全都只能从这口锅里分**。要让「遗迹格随层增加并给下限」成立，就得给深层腾格子。
 *
 * 口径：`空占比 = max(下限, 50% − 每层递减 × (层 − 1))`（**相对"可分配池"而言**）。
 * ⚠ 量纲是"**占池**"不是"占总格数"：本层可分配池 = 全部格 − 终点格（终点不参与分配）；
 * 旧式 `ceil(nAll × 50%)` 在层 1（19 格）得 10 空、池只有 18 ⇒ 实际 55.6% 占池。本批明确为"占池"后
 * **层 1 逐格不变**（19 格、10 空），变的只是深层。
 *
 * ⚠ **2026-09-20 船长改判**：「空信息地点占比只进行略微下降。**每层降低1%**」（旧口径 = 每层 −4%）
 * ⇒ 层 1~10 = **50/49/48/47/46/45/44/43/42/41%**，**下限仍取 32%**（船长同批确认保留）⇒ 层 19 触底。
 * 为什么这么改：半径改成"每层 +1 环、上不封顶"之后，盘面本来就随层变大；再把空占比猛降会让深层
 * "信号格爆炸"（既没必要、也压垮回合预算）⇒ 只微降，让"越深内容越多"由**盘面变大**承担。
 */
export const WORMHOLE_EMPTY_SHARE_PER_DEPTH = 0.01
/** 空地点占比的**地板**（再深也不低于它——保住"三层里有一层是空的"这个体感） */
export const WORMHOLE_EMPTY_SHARE_FLOOR = 0.32
/**
 * 第 `depth` 层的空地点占比（**占可分配池的比例**；乘 100 即"百分比"）。
 *
 * `blankShareFactor` = 外部给的**相对系数**（2026-09-14 船长「事件玄学」：满级 ×0.8 ⇒ 相对 −20%，
 * 接线见 `wormhole.ts blankShareFactorOf`；缺省 1 ⇒ 一字不变）。
 * ⚠ **必须先取该层基础占比（含 0.32 地板）、再乘系数**——反过来先乘再取地板的话，深层会被地板
 * 吃回 0.32、技能在深层等于完全没用（本批的"相对削减"口径就是冲着这一点定的）。
 */
export function wormholeEmptyShareFor(depth: number, blankShareFactor = 1): number {
  const d = Math.max(1, Math.floor(depth))
  const base = Math.max(WORMHOLE_EMPTY_SHARE_FLOOR, WORMHOLE_EMPTY_MIN_SHARE - WORMHOLE_EMPTY_SHARE_PER_DEPTH * (d - 1))
  return base * Math.max(0, blankShareFactor)
}

/**
 * **每层遗迹格下限**（船长 2026-09-13：「让遗迹格数量随层数增加并给每层增加一个遗迹格下限」）。
 *
 * `下限 = 1 + ⌊(层 − 1) ÷ 2⌋` ⇒ 层 1~2 = 1 · 层 3~4 = 2 · 层 5~6 = 3 …
 * ⚠ **本阶梯自己走"每 2 层 +1"，与网格半径不再同步**：半径自 2026-09-20 起是"每 1 层 +1 环"，
 * 而遗迹保底是船长同日审核过的 1~10 层明细表里的那一列（层 3/4 ≥2 · 层 5/6 ≥3 · 层 7/8 ≥4 · 层 9/10 ≥5）
 * ⇒ **刻意不动**；旧注释"刻意沿用网格半径那条节拍（也是每 2 层 +1）"已过时。
 *
 * 与旧口径的关系：**不推翻** `WORMHOLE_RUINS_SHARE = 30%`（船长 2026-09-13「遗迹概率降低到 30%」），
 * 只在它上面加**地板**——残骸信号分完墓场后剩下的都给遗迹，但仍保证 ≥ 下限。
 */
/**
 * **遗迹保底的起效层**（船长 2026-09-16：「**遗迹的保底，改为从3层开始保底。1层没有遗迹**」）。
 *
 * ⇒ 层 1 **一个遗迹都不出**（残骸信号全给舰船墓场）· 层 2 **允许出但没有保底**（可能一个都没有）·
 * **层 3 起才保底**。⚠ 「遗迹密集」原型的**遗迹专属加成（份额 30% → 50% · 下限 +1）同样从本层起才生效**
 * ——浅层（层 1/2）它只体现为"残骸更多"（`wreck` 权重 ×1.4）。
 */
export const WORMHOLE_RUINS_FLOOR_MIN_DEPTH = 3

/** 第 `depth` 层遗迹格数**下限**（层 1/2 = **0**（无保底；层 1 另由生成器禁止出遗迹）；层 3 起 `1 + ⌊(层-1)÷2⌋`） */
export function wormholeRuinsFloorFor(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  if (d < WORMHOLE_RUINS_FLOOR_MIN_DEPTH) return 0
  return 1 + Math.floor((d - 1) / 2)
}

/**
 * **星云机制**（船长 2026-09-13）：「在四层以上及以上，添加星云机制，玩家第一次扫描出一个地点时，
 * 有星云的地点，星云会遮挡该地点的信号。需要玩家再扫描一次才能驱散星云。」
 *
 * 口径（经办确认 + 船长补正）：
 * - **只遮"有信号的地点"**（船长补正：「**空地没有星云**」）⇒ `empty` 与下一层入口（信标格）都不长星云，
 *   否则玩家白花一个回合才发现"这儿本来就什么都没有"；
 * - **层 4 起才有**；第一次下到层 4 会给一次性提示 + 一条通讯（见 `wormhole.ts` 与 `docs/comms.ts`）；
 * - **驱散 = 一次扫描动作**：把扫描圈内**所有**被遮蔽的格一起驱散（不是每格一次）；
 * - **不额外给奖励**：它是"回合税"，不是收益机制（要奖励会与"遗迹下限"叠加过强）。
 */
export const WORMHOLE_NEBULA_MIN_DEPTH = 4
/**
 * **星云占比**（船长 2026-09-19：「**提高4层后星云的占比**」；**2026-09-20 再次改判**：
 * 「星云遮蔽**每层提高2%**。**封顶80%**」）。
 *
 * 口径：层 4 基数 **20%** 不变，此后每层 **+2%**，**封顶 80%**（层 34 触顶）
 * ⇒ 层 4/5/6/7/8/9/10 = 20/22/24/26/28/30/32%。
 * ⚠ 旧口径「每层 +5%、封顶 40%」**作废**；旧护栏 `WORMHOLE_NEBULA_MAX_SHARE = 0.5`
 * （"最多占有信号格的一半"）**同日删除**——它与新封顶重复，留着会让 80% 永远到不了（层 20 起被压回 50%）。
 * 配额算法不变：`⌈可长星云的格数 × 本比例⌉`。完整 1~10 层表见 `docs/roadmap.md` 2026-09-20「虫洞盘面新台阶」那条。
 */
export const WORMHOLE_NEBULA_SHARE = 0.2
/** 每层递增量（层 4 起，每下一层 +2%） */
export const WORMHOLE_NEBULA_SHARE_STEP = 0.02
/** 封顶（层 34 及更深恒 80%） */
export const WORMHOLE_NEBULA_SHARE_CAP = 0.8

/** 第 `depth` 层**该用多少星云占比**（层 <4 返回 0 = 没有星云；层 4 起 20% + 每层 2%、封顶 80%） */
export function wormholeNebulaShareFor(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  if (d < WORMHOLE_NEBULA_MIN_DEPTH) return 0
  return Math.min(WORMHOLE_NEBULA_SHARE_CAP, WORMHOLE_NEBULA_SHARE + WORMHOLE_NEBULA_SHARE_STEP * (d - WORMHOLE_NEBULA_MIN_DEPTH))
}

/** **遗迹占残骸信号的比重**（船长：「遗迹概率降低到 30%」⇒ 舰船墓场 70%） */
export const WORMHOLE_RUINS_SHARE = 0.3

/**
 * **谜质格下限 = 每层保底 1 个**（船长 2026-09-13 裁定：「每层保底 1 个谜质格」）。
 * 谜质格由「雷达信号」按概率分出 ⇒ 理论上小盘面（层 1/2 只有 19 格）可能一个都不出。
 * 兜底手法与遗迹下限同款：**只换不重掷**（优先把"空地"翻成谜质，不动别的地点）。
 *
 * ⚠ **实测读数（2026-09-13）**：把这段兜底关掉、跑 seed 1~200 × 层 1~6 共 **1200 张盘**，
 * **0 张盘是 0 个谜质格** —— 即当前权重下"保底"是**保险丝**、不是承重墙（雷达配额本来就够分出谜质）。
 * 留着是为了**以后改信号权重时这条保证仍然成立**；用例 `wormhole-matter.test.ts` ② 钉的是
 * **结果契约**（每层 ≥ 1 个谜质格），两种实现下都必须绿。
 */
export const WORMHOLE_MATTER_FLOOR = 1

/** 地点 → 对外信号（`empty` 无信号；`graveyard`/`ruins` 都表现为「残骸信号」） */
export function signalOfPlace(place: WormholePlace): WormholeSignal | null {
  switch (place) {
    case 'empty':
      return null
    case 'graveyard':
    case 'ruins':
      return 'wreck'
    case 'ship':
      return 'ship'
    case 'vein':
      return 'resource'
    case 'matter':
      return 'radar'
    case 'beacon':
      return 'beacon'
  }
}

/**
 * **每层网格半径**（**2026-09-20 船长二次改判**：「**那还是改回「每 2 层 +1」的机制，不封顶**」）：
 * 第 1 层 R=2（19 格），**每 2 层 +1 环**、**不设上限**。
 *
 * 口径：`R = 2 + ⌊(层 − 1) ÷ 2⌋` ⇒ 层 1~2 = 2 · 层 3~4 = 3 · 层 5~6 = 4 · 层 7~8 = 5 · 层 9~10 = 6 …
 * （19/19/37/37/61/61/91/91/127/127 格）。⚠ **与旧口径的差别只在"封顶"**：
 * 旧口径（2026-09-13 起）是"每 2 层 +1、**封顶 R=4**"（层 7 起恒 61 格），
 * 本裁定**保留节拍、去掉封顶** ⇒ 层 7 起继续长（旧常量 `WORMHOLE_GRID_R_MAX` 已删）。
 * ⚠ 同日曾先改判为"每 1 层 +1 环"（R = 2+(层−1)），当日按船长本句**改回**——两版都已在
 * `tests/wormhole-grid.test.ts` 钉住现值，别再回改。
 * 依据：船长同日的两条配套裁定——**回合预算已由科技（时序锚定器 ＋100 回合）支撑**，
 * 空信息占比改为**每层只降 1%**（见 `WORMHOLE_EMPTY_SHARE_PER_DEPTH`）；
 * 界面侧对 `R > 8` 走"跟随玩家自动放大"（见 `panels/Wormhole.tsx`；现阶梯下 R>8 出现在层 15 之后）。
 * 完整 1~12 层表见 `docs/roadmap.md` 2026-09-20「虫洞盘面阶梯二次改判」那条（归档口径同在那里）。
 */
export const WORMHOLE_GRID_R_MIN = 2
export function wormholeGridRadiusFor(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return WORMHOLE_GRID_R_MIN + Math.floor((d - 1) / 2)
}

/**
 * **信标出现率**（**2026-09-20 船长**：「**虫洞中，信标的出现率降低到50%，但是有每层1个的保底数量**」）。
 *
 * 口径：权重表**不动**（信标仍恒 10 ⇒ `content:check` 的「内容原型＋敌族锁定契约」照旧），
 * 最大余数法照旧算出该层的**信标名额**（原来的"逐层定额"），随后**逐个名额掷 50%**；
 * 名额 ≥1 而全部落空时**保底留 1 个**（层 1 起每层恒有指路件）。
 * 被砍掉的名额**按权重让给其余四类信号**（不变成空地）——这样**空信息占比阶梯一字不动**，
 * 其余地点数量只是略微上浮。
 * ⚠ 随机流独立（`+29`）⇒ 空地点洗牌（`+0`）、分配洗牌（`+17`）与逐格 `pickPlace` 的骰子都不受影响，
 * 且同 `(seed, depth)` 仍必得同盘。
 * ⚠ **旧口径"信标数逐层定额、不随 seed 漂"（2026-09-13）由此作废**——本令要的就是"率"。
 */
export const WORMHOLE_BEACON_RATE = 0.5

/**
 * **读档校验用的半径上限**（只是"坏档护栏"，**不是玩法上限**）。
 *
 * ⚠ **2026-09-20 事故与教训**（玩家报障「**玩家虫洞深入下一层后，显示本层没有网格**」）：
 * `save.ts` 的 `cleanWormholeGrid` 当年写死 `radius <= 8`——那时阶梯是"每 2 层 +1、**封顶 R=4**"，
 * 8 是留了两倍余量；本批把阶梯改成"每层 +1 环、**上不封顶**"后没人回头看它
 * ⇒ **层 8 起（R=9+）的盘在读档时被整块丢掉**（该层退回旧式线性地图 ⇒ 界面显示「本层没有网格」）。
 * 口径：**这个数只随"存档里出现离奇大的 radius"而设，与阶梯彻底解耦**——以后再改阶梯**不必动它**；
 * 真要动阶梯，请跑用例 `save.test.ts`「存档往返逐层保住网格」。
 */
export const WORMHOLE_GRID_SAVE_MAX_R = 64

/** **初始扫描半径 = 1 格**（船长原话；后续可由装备/谜质/技能提升——字段留着） */
export const WORMHOLE_SCAN_RADIUS_BASE = 1

/* ═══════════ 三、每层网格状态（可存档的纯数据） ═══════════ */

/**
 * 格上的战利品堆（残骸/稀有残骸/矿……）。
 * ⚠ 结构同 `wormhole.WormholePile`，但**在这里另立一份**：`wormhole.ts` 要 import 本文件，
 * 本文件若反过来 import `WormholePile` 就成环（`state → wormhole → wormholeGrid → wormhole`）。
 * TS 是结构类型 ⇒ 两者互相赋值无障碍（`save.ts` 的清洗也照同一形状走）。
 */
export interface WormholeCellPile {
  itemId: string
  units: number
}

/** 一格（真相随档；**信号遮蔽靠"未扫描不展示"实现**，不是靠不存） */
export interface WormholeGridCell {
  key: string
  q: number
  r: number
  /** 真相：到达后才知道 */
  place: WormholePlace
  /** 该格上还没被搬走的堆（F3b 打捞/挖矿往里放；非资源地点不写该字段） */
  piles?: WormholeCellPile[]
  /**
   * **这一格被星云罩着**（船长 2026-09-13 星云机制；层 4 起、只长在有信号的地点上）。
   * ⚠ 它**不改变真相**（`place`/`piles` 照旧），只是让**已扫描**的格先显示"星云遮蔽"，
   * 要再花一次扫描动作驱散（见 `WormholeGridState.dispersed`）。可选字段 ⇒ 老档零迁移。
   */
  nebula?: boolean
  /**
   * **围剿者**（**2026-09-23 船长新机制**：「7 层开始，玩家每经过一回合，就在地图随机格子刷出一个敌人，
   * 采用类似星云的方式覆盖在原格子之上……敌人不会刷在下一层入口格，敌人有概率刷到玩家当前格，
   * 如果刷到玩家当前格就触发袭击事件」）。
   *
   * - `card`：开打用的敌卡（**刷出那一刻**从该层档位池抽定，存下来 ⇒ 读档后仍是同一张）；
   * - `seq`：本层第几个围剿者（随机流的序号，便于复现与读数）；
   * - `cleared`：已打掉 ⇒ **覆盖解除、原格内容照旧**（船长：「打掉后进入原内容」）。
   *
   * ⚠ **不写 `activated`**：`activated` 另有一条语义（采空/打完 ⇒ 该格的事做完了，矿脉/墓场的"只铺一次"
   * 闸门读它）——围剿者盖在**任何**格上（含未铺过堆的资源格），若打掉就写 `activated`，
   * 那一格的产出会被永久封死。故围剿者的存废只看本字段。
   * ⚠ **顶掉星云**（船长：「这个敌人会直接覆盖星云的效果」）：落在星云格上时把该格记进 `dispersed`
   * ⇒ 打掉后直接看到原内容，不用再扫一次。
   */
  foe?: { card: string; seq: number; cleared?: boolean }
}

export interface WormholeGridState {
  /** 本层半径（决定盘内格数） */
  radius: number
  /** 入口格（玩家初始随机落点，落在外圈） */
  start: HexCell
  /** **下一层入口**（随机位置；到达并激活 ⇒ 触发层末守卫战，F3b 接） */
  exit: HexCell
  /** 玩家当前所在格 */
  pos: HexCell
  /** 当前扫描半径（船长：初始 1 格，可提升） */
  scanRadius: number
  /** **已扫描**的格（只是"知道信号"，不等于到过） */
  scanned: string[]
  /** **已到达**的格（到达即揭示真相） */
  visited: string[]
  /** **已激活**的格（打捞/挖矿/战斗/取谜质各自只算一次，重复来不重复计） */
  activated: string[]
  /**
   * **已结算「首捞掉落」的遗迹格**（2026-09-16 船长改时机：「**时间点改为遗迹第一次打捞**」）。
   *
   * 口径：遗迹格的三个掷点——**遗迹安全货柜（70% · 层 2 起）· AI 核心（10%）· 惊扰守卫（当场开战）**——
   * 由原来的"**这一格打捞完**（堆清空）那一拍"提前到"**这一格第一次真正收走至少一堆**的那次打捞"，
   * 掷中**即发货**（货柜/核心走收货阶梯、守卫当场开战）。本数组记已结算的格键 ⇒ **每格只结算一次**
   * （与 `activated` 同款"格键数组"形态、**随档**；空数组不写 ⇒ 老档零迁移 = 这些格还没首捞过）。
   * ⚠ 与 `activated` 的区别：`activated` 是"这一格做完了"，本字段是"这一格的掉落已经掷过了"——
   * 首捞之后即使没清完也不会再掷（反之亦然）。
   */
  ruinsRolled?: string[]
  /**
   * **下一层入口（下潜点）是否已被标出**（F3a-3 · 船长 2026-09-13 新增信标信号）。
   *
   * 口径：入口默认**不在地图上显示**（船长：「玩家只有到达目标地点后才能知道目标地点的确切信息」）；
   * 两条途径把它标出来（**都收口到 `markExitKnown`**）：
   * ① **到达"漂浮信标"那一格**（船长 2026-09-13）——不靠近也能远程得知；
   * ② **扫描把入口格本身扫进本圈**（船长 2026-09-16 裁定**甲案**：「玩家扫描无法直接扫出下一层入口」
   *    是缺陷 ⇒ 扫到就该标上地图）。
   * 可选字段（老档没有 = 没被标出 ⇒ 零迁移）。
   */
  exitKnown?: boolean
  /**
   * **已被驱散的星云格**（船长 2026-09-13 星云机制）。
   *
   * 判据在 `revealOf`：`cells[i].nebula === true` 且**不在此数组里** ⇒ 该格对玩家显示为「星云遮蔽」；
   * 进数组的时机 = 玩家对"已扫描且在本圈内"的星云格**再扫一次**（`wormholeGridScan`）。
   * 可选字段（老档没有 = 没有星云可驱散 ⇒ 零迁移）。
   */
  dispersed?: string[]
  /**
   * **本层已刷出的围剿者个数**（2026-09-23 新机制 · 随机流序号，**随档**）。
   * 每次刷怪用它算盐值（`hash(本趟种子, 层, 序号)`）⇒ 同一趟同一序号必得同一格、同一张卡（可复现、可测）。
   * 可选字段 ⇒ 老档零迁移（缺失 = 0 ⇒ 从第一个围剿者开始刷）。
   */
  spawnSeq?: number
  /** 全部格（真相在这里；对外按 `scanned`/`visited` 决定展示到什么程度） */
  cells: WormholeGridCell[]
}

/** 该格此刻**对外可见的信息**（未知 / 只有信号 / **被星云遮住** / 已知真相） */
export type WormholeCellReveal =
  | { kind: 'unknown' }
  /** `signal === null` = **空信息地点**（船长 2026-09-13：扫开发现"这里什么都没有"，占全盘 ≥50%） */
  | { kind: 'signal'; signal: WormholeSignal | null }
  /**
   * **星云遮蔽**（船长 2026-09-13）：已扫描、但这一格被星云罩着且还没驱散
   * ⇒ **信号与地点都不给**（"遮挡该地点的信号"），要再花一次扫描动作驱散。
   */
  | { kind: 'nebula' }
  /**
   * **围剿者压在这一格上**（2026-09-23 新机制）：**优先级最高**——不管这格有没有扫描过、有没有星云，
   * 只要压着没打掉的围剿者，**右上角那枚族徽就一直看得见**（船长：「敌人看得到这个标记」）。
   *
   * ⚠ **2026-09-24 船长令改判显示形态**：「**改为照常显示下方地点信号，族徽位置移动到右上角探索过的小点处**」
   * ⇒ 中心那一格**照旧按原遮蔽规则**画，`under` 带的就是"撇开围剿者、这一格本来会揭示成什么"
   * （**永不取 `foe`**：未扫描 ⇒ `unknown` · 星云未驱散 ⇒ `nebula` · 扫开 ⇒ `signal` · 去过 ⇒ `known`）。
   * 界面拿 `kind === 'foe'` 画右上角族徽、拿 `under` 画中心符号，两者互不顶替。
   */
  | { kind: 'foe'; under: WormholeCellReveal }
  | { kind: 'known'; signal: WormholeSignal | null; place: WormholePlace }

/** 查格（坏键 ⇒ undefined） */
export function gridCellAt(grid: WormholeGridState, cell: HexCell): WormholeGridCell | undefined {
  return grid.cells.find((c) => c.key === hexKey(cell.q, cell.r))
}

/**
 * **把"下一层入口"标出来 —— 唯一收口**（两条途径共用它，见 `exitKnown` 的字段注释）：
 * ① **读到漂浮信标**（船长 2026-09-13 口径：信标把入口标在地图上）；
 * ② **扫描把入口格本身扫进本圈**（船长 2026-09-16 裁定**甲案**）。
 *
 * 为什么②必须给（甲案的现场证据）：入口格不参与信号分配 ⇒ 它的 `place` 恒为
 * `empty`（`wormholeMakeGrid`）⇒ 扫到它时 `revealOf` 只给 `signal(null)`，界面据
 * `exitKnown` 判入口、于是**扫过也画成「没有信号：空信息地点」**——玩家扫到了入口位置
 * 却认不出来，这就是船长报的那个问题。扫描把出口格一并扫进 `scanned`（`gridScanTargets`
 * 从来不排除它），所以②在判据上与①同源：**这一格"已知"了，入口就该标出来**。
 *
 * 顺带把入口格并入 `scanned`（幂等）：否则玩家从地图知道入口在哪、点「前往」却会撞上
 * 「这个地点还没扫描过：前往未知地点？」——那句话此时是误导，**它不是未知地点，它是入口**。
 */
export function markExitKnown(grid: WormholeGridState): void {
  grid.exitKnown = true
  const key = hexKey(grid.exit.q, grid.exit.r)
  if (!grid.scanned.includes(key)) grid.scanned.push(key)
}

/**
 * **信标揭示"一处谜质信号" —— 第 2 个及以后的信标干的事**（船长 2026-09-20：
 * 「**信标第一次显示下一层入口，后续还激活其他信标则显示谜质位置**」＋「**信标能穿透星云**」）。
 *
 * 口径：
 * - 挑**离玩家当前位置最近**、`place === 'matter'`、且**还没进 `scanned`** 的那一格
 *   （"已扫描"就是"已揭示"的记录 ⇒ 玩家自己扫过的谜质格不重复揭示，信标去找下一个）；
 * - 揭示动作 = 并入 `scanned`（地图上出现**谜质信号**；内容仍要到达才知，与信号遮蔽那套一致）
 *   ＋ **若该格被星云罩着，一并驱散**（船长明确"信标可穿透星云" ⇒ 复用 `disperseNebulae` 单点）；
 * - 没有可揭示的谜质格 ⇒ 返回 `null`（调用方就此写一条"没有新的谜质可标"的日志；回合照扣，不退）。
 *
 * ⚠ **"第几个信标"不新增存档字段**：由调用方数 `grid.activated` 里 `place === 'beacon'` 的格数即得。
 */
export function revealNearestMatterCell(
  grid: WormholeGridState,
  from: HexCell,
): { cell: WormholeGridCell; nebulaDispersed: boolean } | null {
  let best: WormholeGridCell | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const c of grid.cells) {
    if (c.place !== 'matter') continue
    if (grid.scanned.includes(c.key)) continue
    if (grid.visited.includes(c.key)) continue
    const d = hexDistance(from, { q: c.q, r: c.r })
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  if (!best) return null
  grid.scanned.push(best.key)
  // **穿透星云**（船长 2026-09-20）：这一格若正被星云罩着，信标直接把雾掀掉
  const nebulaDispersed = isNebulaFogged(grid, best)
  if (nebulaDispersed) disperseNebulae(grid, [{ q: best.q, r: best.r }])
  return { cell: best, nebulaDispersed }
}

/* ═══════════ 三之二之二、围剿者（2026-09-23 船长新机制：7 层起逐回合刷怪） ═══════════ */

/**
 * **围剿机制的适用层**（船长：「7层开始」⇒ **层 ≥ 7 永久生效**，层 7、8、9… 都刷）。
 */
export const WORMHOLE_SPAWN_MIN_DEPTH = 7

/**
 * **每层围剿者上限**（船长：「每层上限**50%**」）= 本层格数 × 50%（向下取整）：
 * 层 7/8（R=5 · 91 格）= **45** · 层 9/10（R=6 · 127 格）= **63**。
 * 计数 = **本层尚未打掉的围剿者**（打掉即腾名额）· **跨层重置**。
 */
export const WORMHOLE_SPAWN_CAP_SHARE = 0.5

/** 该格此刻**是否压着一个没打掉的围剿者**（唯一判据：拦截 / 揭示 / 界面 / 结算都读它） */
export function hasLiveFoe(cell: WormholeGridCell): boolean {
  return cell.foe !== undefined && cell.foe.cleared !== true
}

/** 本层还没打掉的围剿者个数 */
export function spawnAliveCount(grid: WormholeGridState): number {
  return grid.cells.reduce((n, c) => n + (hasLiveFoe(c) ? 1 : 0), 0)
}

/** 本层围剿者上限（格数 × 50%） */
export function spawnCapOf(grid: WormholeGridState): number {
  return Math.floor(grid.cells.length * WORMHOLE_SPAWN_CAP_SHARE)
}

/**
 * **候选格**（船长口径）：
 * ① 排除**下一层入口格**（「敌人不会刷在下一层入口格」）；
 * ② 排除**已经有敌人的格**（「敌人不会刷在已经有敌人的节点上」）= 压着围剿者，或原舰船信号格**还没清掉**；
 * ③ 其余一律可刷：未扫描/已扫描、空格、星云格、**已清掉的旧敌人格**、**玩家当前格**（刷到就触发袭击）。
 * ⚠ 顺序 = `grid.cells` 原序（盘面生成序，稳定）⇒ 同序号必得同格。
 */
export function spawnTargetsOf(grid: WormholeGridState): WormholeGridCell[] {
  const exitKey = hexKey(grid.exit.q, grid.exit.r)
  return grid.cells.filter((c) => {
    if (c.key === exitKey) return false
    if (hasLiveFoe(c)) return false
    if (c.place === 'ship' && !grid.activated.includes(c.key)) return false
    return true
  })
}

/* ═══════════ 三之三、路径拦截（2026-09-16 船长新增） ═══════════ */

/**
 * **路径拦截判定**（船长 2026-09-16）：从玩家当前格前往 `target`，这条**直线路径**上
 * **最近的一处"还没清掉的舰船信号格"**（`place === 'ship'` 且不在 `activated` 里）。
 *
 * 口径（六问六答 ＋ §5.2 甲案）：
 * ① **起点与终点都不算**——起点是自己站的格；终点若本身是舰船信号 ⇒ 走既有的"到达即开打"，不重复判；
 * ② **未扫描的格照样拦**（船长裁定 1 = 乙）："看不见的敌人也会挡路"；
 * ③ **已清掉的格不拦**（打赢一次就通了；同一格不会被连拦两次）；
 * ④ 找不到 ⇒ `undefined`（本次移动直达目标）。
 *
 * ⚠ **界面预览与移动判定共用本函数**（同一把尺）：界面据此画路径与描红，引擎据此刻断移动 ——
 * "界面记得拦"不是纪律，"两边同一把尺"才是（照 `unknown-target` 那道闸的先例）。
 *
 * ⚠ **出口格（层末守卫）不在此列**：守卫只认"站在出口格上点激活"，不参与路径拦截（船长裁定 1 = 乙
 * 只覆盖舰船信号格）。
 */
export function wormholePathInterceptAt(
  grid: WormholeGridState,
  target: HexCell,
): WormholeGridCell | undefined {
  const line = hexLine(grid.pos, target)
  // 掐头去尾：`line[0]` = 当前格、`line[last]` = 目标格
  for (let i = 1; i < line.length - 1; i++) {
    const cell = gridCellAt(grid, line[i]!)
    if (!cell) continue
    const liveFoe = hasLiveFoe(cell)
    // 围剿者也挡路（船长 2026-09-23：「挡路」）——与舰船信号格同一条尺
    if (cell.place !== 'ship' && !liveFoe) continue
    if (cell.place === 'ship' && !liveFoe && grid.activated.includes(cell.key)) continue
    return cell
  }
  return undefined
}

/**
 * 某格对外揭示到什么程度（**这条是"信号遮蔽"的唯一判据**）。
 *
 * ⚠ 2026-09-13 F3a-2 修正：首版这里写的是 `signalOfPlace(place) ?? 'ship'` —— 把**空信息地点
 * 伪装成"舰船信号"**，后果是船长定的「空信息地点占 ≥50%」在界面上根本看不出来（半张盘全是
 * 舰船信号，扫描反而在骗人）。改成如实给 `null`（扫开 = "没有信号"），与 `signalOfPlace` 同源。
 */
export function revealOf(grid: WormholeGridState, cell: HexCell): WormholeCellReveal {
  const c = gridCellAt(grid, cell)
  if (!c) return { kind: 'unknown' }
  const under = revealWithoutFoe(grid, c)
  // **围剿者优先于一切**（含星云与"没扫过"）：它是压在这一格上的、玩家看得见的敌人 ——
  // ⚠ 但"优先"只体现在**右上角族徽一定画**（2026-09-24 船长令）；中心那一格照旧走 `under`。
  if (hasLiveFoe(c)) return { kind: 'foe', under }
  return under
}

/**
 * **撇开围剿者不谈，这一格本来会揭示成什么**（`revealOf` 的正文；`foe` 档的 `under` 与它同源）。
 * 顺序就是既有口径：**去过 > 扫过 > 没扫过**；扫过的星云格在驱散前只给星云。
 */
function revealWithoutFoe(grid: WormholeGridState, c: WormholeGridCell): WormholeCellReveal {
  if (grid.visited.includes(c.key)) return { kind: 'known', signal: signalOfPlace(c.place), place: c.place }
  if (grid.scanned.includes(c.key)) {
    // **星云遮蔽**（层 4 起）：扫开了也先只看到星云，再扫一次才驱散（船长 2026-09-13）
    if (c.nebula === true && !(grid.dispersed ?? []).includes(c.key)) return { kind: 'nebula' }
    return { kind: 'signal', signal: signalOfPlace(c.place) }
  }
  return { kind: 'unknown' }
}

/* ═══════════ 三之二、星云（层 4 起 · 回合税机制） ═══════════ */

/** 该格是否**还被星云罩着**（未驱散）；不是星云格 / 已驱散 ⇒ false */
export function isNebulaFogged(grid: WormholeGridState, cell: WormholeGridCell): boolean {
  return cell.nebula === true && !(grid.dispersed ?? []).includes(cell.key)
}

/**
 * **这一圈里有几格星云可以被"再扫一次"驱散** = 已扫描 + 在本圈内 + 还没驱散。
 * （未扫描的星云格要**先扫出来**——第一次扫描只"发现星云"，不驱散，这是船长的口径。）
 */
export function gridNebulaTargets(grid: WormholeGridState, extraRadius = 0): HexCell[] {
  const r = Math.max(0, Math.floor(grid.scanRadius + extraRadius))
  return hexDiskAround(grid.pos, r).filter((c) => {
    const cell = gridCellAt(grid, c)
    return !!cell && grid.scanned.includes(cell.key) && isNebulaFogged(grid, cell)
  })
}

/**
 * **这一次扫描要驱散哪些星云**（`wormholeGridScan` 用）：
 * ① 本圈（含装置加出来的额外圈）里"已扫到但还被云罩着"的格；
 * ② 再按装置给的 `extraCount` 从**圈外**补几格**最近**的云（谜质「星云驱散器」：
 *    「每次扫描额外驱散 N 格星云」——额外的那几格不受圈限制，否则装了也白装）。
 */
export function gridNebulaDisperseTargets(
  grid: WormholeGridState,
  extraRadius = 0,
  extraCount = 0,
): HexCell[] {
  const inRing = gridNebulaTargets(grid, extraRadius)
  if (extraCount <= 0) return inRing
  const r = Math.max(0, Math.floor(grid.scanRadius + extraRadius))
  const keys = new Set(inRing.map((c) => hexKey(c.q, c.r)))
  const outside = grid.cells
    .filter((c) => !keys.has(c.key) && grid.scanned.includes(c.key) && isNebulaFogged(grid, c))
    .filter((c) => hexDistance(grid.pos, c) > r)
    .sort((a, b) => hexDistance(grid.pos, a) - hexDistance(grid.pos, b) || (a.key < b.key ? -1 : 1))
    .slice(0, Math.max(0, Math.floor(extraCount)))
  return [...inRing, ...outside.map((c) => ({ q: c.q, r: c.r }))]
}

/** **驱散星云**（就地改状态；由 `wormholeGridScan` 在扣回合之后调用）。返回本次驱散的格键 */
export function disperseNebulae(grid: WormholeGridState, cells: readonly HexCell[]): string[] {
  const done: string[] = []
  for (const c of cells) {
    const cell = gridCellAt(grid, c)
    if (!cell || !isNebulaFogged(grid, cell)) continue
    grid.dispersed = [...(grid.dispersed ?? []), cell.key]
    done.push(cell.key)
  }
  return done
}

/** 一次的扫描会揭示哪些格（当前格 + 周围一圈；**不含**已扫过的） */
export function gridScanTargets(grid: WormholeGridState, extraRadius = 0): HexCell[] {
  const r = Math.max(0, Math.floor(grid.scanRadius + extraRadius))
  return hexDiskAround(grid.pos, r).filter((c) => {
    const cell = gridCellAt(grid, c)
    return !!cell && !grid.scanned.includes(cell.key)
  })
}

/** 到某格需要几回合（船长：前往其他地点消耗 1 回合 ⇒ 与距离无关） */
export const WORMHOLE_TURN_PER_MOVE = 1
/** 扫描一次消耗（船长：扫描需要消耗一回合） */
export const WORMHOLE_TURN_PER_SCAN = 1
/**
 * **一次"作业动作"消耗的回合**（打捞 / 采集各一次动作）：
 * 一次动作（1 回合）回收 = 打捞器（或采集器）台数 的堆 ⇒ 总回合 = ⌈堆数 ÷ 台数⌉
 * （船长 2026-09-13：「每个打捞器每次能回收 1 堆残骸」）。
 *
 * ⚠ **2026-09-15 改名归位**：原名 `WORMHOLE_TURN_PER_ACTIVATE`（旧口径"激活地点也花 1 回合"被复用到
 * 打捞/采集上）。船长当日「**移除玩家激活时需要消耗1回合（包括层末守卫）**」⇒ **激活本身不再花回合**
 * （`wormholeGridActivate` 一分子儿都不扣），打捞/采集的这条口径**单独成常量**、数值仍是 1 ⇒ 行为不变。
 */
export const WORMHOLE_TURN_PER_WORK = 1
/**
 * 手动拾取一堆消耗（船长口径第 13 条「每捡一堆 +1」）。
 * ⚠ 只用于**手拾**（矿脉的虚空母矿、留给玩家的散堆）；**残骸打捞**走打捞器口径——
 * 一次动作（1 回合）回收 = 打捞器台数 的堆（船长 2026-09-13：「每个打捞器每次能回收 1 堆残骸」
 * ⇒ 总回合 = ⌈堆数 ÷ 台数⌉）。
 */
export const WORMHOLE_TURN_PER_PICK = 1

/* ═══════════ 四、确定性生成（同 seed+depth ⇒ 同盘） ═══════════ */

/** 轻量确定性随机（与 `wormholeMakeNode` 同款口径：纯函数、不占存档 rng、可复现） */
export function wormholeRng(seed: number): () => number {
  let s = (Math.floor(seed) % 2147483647) || 1
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/**
 * **32 位整数散列**（splitmix32 的终混三步）：把"混合种子"打成一个均匀的 32 位值。
 * 为什么需要它（2026-09-13 F3b 实测抓到的坑）：`wormholeRng` 是**线性同余**，
 * 它的**第一次输出 ≈ 种子 × 16807 ÷ 2³¹** ⇒ 种子小的时候第一次输出必然极小
 * （种子 1 ⇒ 7.8e-6、种子 1 万 ⇒ 0.078）⇒ 凡"抽一次就完事"的地方（遗迹专属、收尾战、矿脉堆数、
 * 墓场堆数）概率全被拉满/拉到下限。散列一步之后，第一输出在整个 [0,1) 上均匀。
 */
export function wormholeHash32(n: number): number {
  let x = Math.floor(n) | 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}

/**
 * **均匀的确定性随机流**：先用 `wormholeHash32` 打散种子，再喂给 LCG。
 * ⚠ **凡是要新建一条随机流的地方都用它**（不要直接 `wormholeStream(混合种子)`）——
 * 否则又踩上面那个"第一次输出偏小"的坑。
 */
export function wormholeStream(seed: number): () => number {
  return wormholeRng(wormholeHash32(seed))
}

/** 按权重挑一个信号（权重表可覆写；坏表 ⇒ 回退舰船信号） */
export function pickSignal(rnd: number, weights: Readonly<Record<WormholeSignal, number>> = WORMHOLE_SIGNAL_WEIGHTS): WormholeSignal {
  const order: WormholeSignal[] = ['ship', 'wreck', 'resource', 'radar', 'beacon']
  const total = order.reduce((s, k) => s + Math.max(0, weights[k] ?? 0), 0)
  if (!(total > 0)) return 'ship'
  let acc = rnd * total
  for (const k of order) {
    acc -= Math.max(0, weights[k] ?? 0)
    if (acc < 0) return k
  }
  return order[order.length - 1]!
}

/**
 * **按信号 + 概率定真相**：
 * - `wreck` ⇒ 70% 舰船墓场 / **30% 遗迹**（船长：遗迹概率降到 30%）；
 * - `ship`/`resource`/`radar`/`beacon` ⇒ 一一对应（舰船 / 矿脉 / 谜质 / 漂浮信标）。
 */
export function pickPlace(signal: WormholeSignal, rnd: number, ruinsShare: number = WORMHOLE_RUINS_SHARE): WormholePlace {
  switch (signal) {
    case 'ship':
      return 'ship'
    case 'resource':
      return 'vein'
    case 'radar':
      return 'matter'
    case 'beacon':
      return 'beacon'
    case 'wreck':
      return rnd < ruinsShare ? 'ruins' : 'graveyard'
  }
}

/**
 * **生成一层的网格**（确定性：同 `(seed, depth)` 必得同盘）：
 * 1. 半径按 `wormholeGridRadiusFor(depth)`；
 * 2. **入口格**：随机落在**外圈**（盘最外层）；
 * 3. **下一层入口**：从盘内其余格随机取一格（保证 ≠ 入口格）；
 * 4. 其余格先按**空占比**铺空地点（层 1 = 50%，随层按 `wormholeEmptyShareFor` 递减 ——
 *    船长 2026-09-13「空地块允许随着高层权重降低」），再把剩下的格按四类权重分配
 *    （**用最大余数法**保证格子数取整后仍可复现）；
 * 5. 残骸信号再按 70/30 分墓场/遗迹，**并保证遗迹 ≥ 每层下限**（`wormholeRuinsFloorFor`，
 *    不够就从"资源/谜质"借残骸信号；舰船与信标不动）；
 * 6. **层 4 起点星云**（`WORMHOLE_NEBULA_MIN_DEPTH`）：只点有信号的地点、配额 15%、独立随机流。
 */
export function wormholeMakeGrid(seed: number, depth: number, extraScanRadius = 0, blankShareFactor = 1): WormholeGridState {
  const rng = wormholeStream(seed * 7919 + depth * 104729)
  const radius = wormholeGridRadiusFor(depth)
  const all = hexDiskCells(radius)
  const outer = all.filter((c) => hexDistance(c, { q: 0, r: 0 }) === radius)
  const start = outer[Math.min(outer.length - 1, Math.floor(rng() * outer.length))]!
  const rest = all.filter((c) => !(c.q === start.q && c.r === start.r))
  const exit = rest[Math.min(rest.length - 1, Math.floor(rng() * rest.length))]!
  // 除入口/终点外的格：先定"是否为空"，再定信号
  const others = all.filter((c) => !(c.q === exit.q && c.r === exit.r))
  const nAll = all.length
  /**
   * **空占比随层下降**（船长 2026-09-13「空地块允许随着高层权重降低」；层 1 逐格不变）。
   * 口径 = **占可分配池的比例**（见 `wormholeEmptyShareFor` 的注释：量纲为什么是"占池"）。
   */
  const emptyCount = Math.max(0, Math.ceil((nAll - 1) * wormholeEmptyShareFor(depth, blankShareFactor)))
  // 洗牌（Fisher–Yates，确定性）后取前 emptyCount 个当"空"（入口/终点也照此参与 ⇒ 它们也可能是空的）
  const shuffled = [...others]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = shuffled[i]!
    shuffled[i] = shuffled[j]!
    shuffled[j] = t
  }
  const emptyKeys = new Set(shuffled.slice(0, emptyCount).map((c) => hexKey(c.q, c.r)))
  // 剩余格按权重分配信号（最大余数法：先按比例取整，余额给余数最大的）
  const pool = others.filter((c) => !emptyKeys.has(hexKey(c.q, c.r)))
  const order: WormholeSignal[] = ['ship', 'wreck', 'resource', 'radar', 'beacon']
  /** **本盘的内容原型**（丙 · 船长 2026-09-14）：只改这张权重表的配比，总量的口径照旧 */
  const archetype = wormholeArchetypeOf(seed)
  const signalWeights = wormholeSignalWeightsFor(archetype)
  /**
   * **遗迹份额**（船长 2026-09-16：「1 层没有遗迹」＋保底从 3 层起）：
   * - **层 1 = 0**（残骸信号全给舰船墓场，一个遗迹都不出）；
   * - **层 2 = 基础 30%**（**不给**原型加成 ⇒ 可能一个都没有；「遗迹密集」的 50% 从层 3 起才生效）；
   * - **层 3+ = 按原型**（均衡/其它原型 30% · 「遗迹密集」50%）。
   */
  const ruinsShare =
    depth < WORMHOLE_RUINS_FLOOR_MIN_DEPTH
      ? depth === 1
        ? 0
        : WORMHOLE_RUINS_SHARE
      : wormholeRuinsShareFor(archetype)
  const totalW = order.reduce((s, k) => s + signalWeights[k], 0)
  const quota = order.map((k) => {
    const exact = (pool.length * signalWeights[k]) / totalW
    return { k, n: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  let left = pool.length - quota.reduce((s, q) => s + q.n, 0)
  for (const q of [...quota].sort((a, b) => b.frac - a.frac || order.indexOf(a.k) - order.indexOf(b.k))) {
    if (left <= 0) break
    q.n += 1
    left -= 1
  }
  /**
   * **遗迹格下限**（船长 2026-09-13「让遗迹格数量随层数增加并给每层增加一个遗迹格下限」）。
   *
   * 做法：先算这份权重会给几个**残骸信号**（`wreckN`），再算它按哪条 70/30 **会**分出几个遗迹——
   * `round(wreckN × 30%)`；**低于下限就补残骸信号**（从"资源"借，不够再借"谜质"；
   * **舰船信号与信标一个不动**——信标是每层唯一的指路标记）。
   * 这样"遗迹随层增加"与"每层有下限"同时成立，且**不改** `WORMHOLE_SIGNAL_WEIGHTS`（其余信号的比例关系照旧）。
   */
  const quotaOf = (k: WormholeSignal): { n: number; frac: number } => quota.find((q) => q.k === k)!
  /** 遗迹下限 = 层基准 + 原型加成（`ruins` 原型 +1；船长 2026-09-14） */
  const ruinsFloorWanted = wormholeRuinsFloorFor(depth) + wormholeRuinsFloorBonusFor(archetype)
  let wreckN = quotaOf('wreck').n
  while (Math.round(wreckN * ruinsShare) < ruinsFloorWanted && wreckN < pool.length) {
    const donor = quotaOf('resource').n > 1 ? 'resource' : quotaOf('radar').n > 1 ? 'radar' : null
    if (!donor) break
    quotaOf(donor).n -= 1
    wreckN += 1
  }
  quotaOf('wreck').n = wreckN
  /**
   * **信标 50% 出现率 + 每层保底 1 个**（船长 2026-09-20；见 `WORMHOLE_BEACON_RATE` 的口径注）：
   * 上面的信标名额是"满额"（原来的逐层定额），这里**逐个名额掷 50%**；全落空且名额 ≥1 ⇒ 保底留 1。
   * 让出来的名额**按权重补给其余四类**（同一套最大余数法、余数大的先补）⇒ 池子仍被填满
   * ⇒ **空信息占比阶梯一字不动**，其余地点数量略微上浮。随机流独立（`+29`），其余骰子不受影响。
   */
  {
    const beaconSlots = quotaOf('beacon').n
    const beaconRng = wormholeStream(seed * 7919 + depth * 104729 + 29)
    let beaconN = 0
    for (let i = 0; i < beaconSlots; i++) if (beaconRng() < WORMHOLE_BEACON_RATE) beaconN += 1
    if (beaconSlots > 0 && beaconN === 0) beaconN = 1 // 保底：每层至少 1 个
    quotaOf('beacon').n = beaconN
    const freed = beaconSlots - beaconN
    if (freed > 0) {
      const rest = order.filter((k) => k !== 'beacon')
      const restW = rest.reduce((s, k) => s + signalWeights[k], 0)
      const add = rest.map((k) => {
        const exact = (freed * signalWeights[k]) / restW
        return { k, n: Math.floor(exact), frac: exact - Math.floor(exact) }
      })
      let restLeft = freed - add.reduce((s, a) => s + a.n, 0)
      for (const a of [...add].sort((x, y) => y.frac - x.frac || order.indexOf(x.k) - order.indexOf(y.k))) {
        if (restLeft <= 0) break
        a.n += 1
        restLeft -= 1
      }
      for (const a of add) quotaOf(a.k).n += a.n
    }
  }
  const signalOfCell = new Map<string, WormholeSignal>()
  let at = 0
  /**
   * **分配顺序必须洗牌**（船长 2026-09-20 裁定「甲」；根因见下）——
   *
   * ⚠ 原先这里是 `const poolShuffled = pool`，注释写"已按上面洗牌后的相对顺序"，**与实现不符**：
   * 上面那次 Fisher–Yates 只洗了 `shuffled` 副本、用来挑"空地点"，而 `pool` 是 `others.filter(...)`
   * ⇒ **保留 `hexDiskCells` 的行优先顺序**（r 从 −R 到 R、行内 q 升序）。于是下面这段"逐类连续占位"
   * 把每类信号铺成了盘面上的一条**横向带**：实测（600 种子 × 层 1~5 = 3000 张盘）同类相邻率 0.317
   * 对随机 0.251（1.26 倍）· 同行同类连 ≥3 格的盘占 **57.0%**（随机 11.9%）· 谜质/矿脉只出现在
   * 盘的下半部分（r ≥ 0 / r ≥ −1）。玩家报的就是"相似地点扎堆"。
   *
   * 修法 = **先洗牌再连续占位**：各类**格数**（`quota`，含遗迹下限借格之后的结果）一字不变，
   * 只把"哪一格归哪一类"随机化。独立随机流（`+17`）⇒ 挑空地那次洗牌与后面逐格 `pickPlace` 的骰子
   * **一律不受影响**（空地点分布与"残骸 70/30"的读数照旧），且同 `(seed, depth)` 仍必得同盘。
   */
  const poolShuffled = [...pool]
  const orderRng = wormholeStream(seed * 7919 + depth * 104729 + 17)
  for (let i = poolShuffled.length - 1; i > 0; i--) {
    const j = Math.floor(orderRng() * (i + 1))
    const t = poolShuffled[i]!
    poolShuffled[i] = poolShuffled[j]!
    poolShuffled[j] = t
  }
  for (const q of order) {
    const bucket = quota.find((x) => x.k === q)!
    for (let i = 0; i < bucket.n; i++) {
      const c = poolShuffled[at++]
      if (c) signalOfCell.set(hexKey(c.q, c.r), q)
    }
  }
  /**
   * **信标不许落在入口格上**（船长 2026-09-13：「**不可以同一格**」）。
   *
   * 为什么必须挪：信标的"读出下一层入口"是**到达时触发**的（`wormholeGridTravel`），
   * 而入口格开局就是"已到达"（`visited`/`scanned` 都由建档时写死）⇒ 信标落在入口格上时，
   * 玩家**站在信标上却读不出终点**，只能先走开一回合再走回来（F3c 第二段的整趟模拟实测踩到）。
   *
   * 做法：**与另一格交换信号**（找 `all` 顺序里第一个"非出口、非入口、信号不是信标"的格），
   * 交换而不是重掷 ⇒ **各信号的格数与实测分布一字不变**（层 1/3 各 1 个信标、层 5 个 3 个的读数照旧）。
   */
  const startKey = hexKey(start.q, start.r)
  if (signalOfCell.get(startKey) === 'beacon') {
    const swap = all.find((c) => {
      const k = hexKey(c.q, c.r)
      if (k === startKey) return false
      if (c.q === exit.q && c.r === exit.r) return false
      const s = signalOfCell.get(k)
      return s !== undefined && s !== 'beacon'
    })
    if (swap) {
      const swapKey = hexKey(swap.q, swap.r)
      signalOfCell.set(startKey, signalOfCell.get(swapKey)!)
      signalOfCell.set(swapKey, 'beacon')
    }
  }
  const cells: WormholeGridCell[] = all.map((c) => {
    const key = hexKey(c.q, c.r)
    const sig = signalOfCell.get(key)
    const place: WormholePlace = sig ? pickPlace(sig, rng(), ruinsShare) : 'empty'
    return { key, q: c.q, r: c.r, place }
  })
  /**
   * **遗迹下限的"硬保证"**（船长 2026-09-13「给每层增加一个遗迹格下限」；**2026-09-16 改判：保底从层 3 起**）。
   *
   * ⚠ 为什么不能只靠"补残骸信号"：70/30 那道分法是**逐格掷骰**（`pickPlace`），
   * 补出来的残骸信号仍可能一张遗迹都不出（层 1 实测 24% 的盘是 0 张遗迹）。
   * 所以这里做**兜底翻转**：真数一遍，不够就把"舰船墓场"按 `all` 顺序翻成遗迹
   * ——与"信标不落入口格"同款手法（**只换不重掷** ⇒ 格数与其余地点分布照旧）。
   * 墓场是"最该让位"的那个：它的专属能效最低（0.09 稀有/回合 vs 遗迹 0.67）。
   *
   * ⚠ **层 1/2 的下限 = 0**（`wormholeRuinsFloorFor` 已按 2026-09-16 裁定返回 0）⇒ 这里天然不翻转；
   * 「遗迹密集」原型的 **+1 加成一并从层 3 起才生效**（`WORMHOLE_RUINS_FLOOR_MIN_DEPTH`）。
   */
  const ruinsFloor =
    depth >= WORMHOLE_RUINS_FLOOR_MIN_DEPTH ? wormholeRuinsFloorFor(depth) + wormholeRuinsFloorBonusFor(archetype) : 0
  let ruinsNow = cells.filter((c) => c.place === 'ruins').length
  if (ruinsNow < ruinsFloor) {
    for (const c of cells) {
      if (ruinsNow >= ruinsFloor) break
      if (c.place !== 'graveyard') continue
      c.place = 'ruins'
      ruinsNow += 1
    }
  }
  /**
   * **谜质格下限**（船长 2026-09-13：「每层保底 1 个谜质格」）：真数一遍，不够就**把空地翻成谜质**
   * ——与遗迹下限同款"只换不重掷"，且优先动**空地**（它本来没产出，翻掉不影响其它地点分布）；
   * 入口格与出口格一律跳过（它们是导航用的）。
   */
  if (depth >= 1) {
    let matterNow = cells.filter((c) => c.place === 'matter').length
    if (matterNow < WORMHOLE_MATTER_FLOOR) {
      for (const c of cells) {
        if (matterNow >= WORMHOLE_MATTER_FLOOR) break
        if (c.key === startKey) continue
        if (c.q === exit.q && c.r === exit.r) continue
        if (c.place !== 'empty') continue
        c.place = 'matter'
        matterNow += 1
      }
    }
  }
  /**
   * **点星云**（船长 2026-09-13；层 4 起）。
   *
   * 只点**有信号的地点**（船长补正「**空地没有星云**」）+ **排除下一层入口**（它是导航标记，
   * 遮住它只会让玩家白扫）。配额 = `⌈有信号格数 × wormholeNebulaShareFor(层)⌉`
   * （2026-09-20 船长令：层 4 起 20% + **每层 2%**、**封顶 80%** ⇒ 层 4~10 = 20/22/24/26/28/30/32%）。
   * ⚠ 原先还夹一道"最多占有信号格的一半"（`WORMHOLE_NEBULA_MAX_SHARE`）——**同日随新封顶删除**：
   * 层 20 起声明占比会超 50%，留着就永远到不了 80%。
   * 打乱用**独立随机流**（`seed × 6619 + depth × 81173`）⇒ 不动主流的消耗序列，
   * 层 1~3 的盘面与改造前**逐格一致**（回归可验）。
   */
  if (depth >= WORMHOLE_NEBULA_MIN_DEPTH) {
    const exitKey = hexKey(exit.q, exit.r)
    const candidates = cells.filter((c) => c.place !== 'empty' && c.key !== exitKey)
    const quotaN = Math.ceil(candidates.length * wormholeNebulaShareFor(depth))
    if (quotaN > 0) {
      const nebRng = wormholeStream(seed * 6619 + depth * 81173)
      const idx = candidates.map((_, i) => i)
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(nebRng() * (i + 1))
        const t = idx[i]!
        idx[i] = idx[j]!
        idx[j] = t
      }
      for (const i of idx.slice(0, quotaN)) candidates[i]!.nebula = true
    }
  }
  return {
    radius,
    start: { q: start.q, r: start.r },
    exit: { q: exit.q, r: exit.r },
    pos: { q: start.q, r: start.r },
    scanRadius: WORMHOLE_SCAN_RADIUS_BASE + Math.max(0, Math.floor(extraScanRadius)),
    // 落点与"到达即揭示"：入口格一开始就算**已到达**（玩家就在那儿）、终点格在到达前不揭示
    scanned: [hexKey(start.q, start.r)],
    visited: [hexKey(start.q, start.r)],
    activated: [],
    // 入口默认不在地图上标出（船长：到达后才知道确切信息）；找到漂浮信标才会置 true
    exitKnown: false,
    cells,
  }
}

/* ═══════════ 五、看板读数（界面与战报共用，避免两处各算一遍） ═══════════ */

/** 一层的盘点读数：格数 / 空地点 / 各信号计数 / 真相计数（**校准与用例的单一出处**） */
export function gridTally(grid: WormholeGridState): {
  total: number
  empty: number
  bySignal: Record<WormholeSignal, number>
  byPlace: Record<WormholePlace, number>
} {
  const bySignal: Record<WormholeSignal, number> = { wreck: 0, ship: 0, resource: 0, radar: 0, beacon: 0 }
  const byPlace: Record<WormholePlace, number> = { empty: 0, graveyard: 0, ruins: 0, ship: 0, vein: 0, matter: 0, beacon: 0 }
  for (const c of grid.cells) {
    byPlace[c.place] += 1
    const s = signalOfPlace(c.place)
    if (s) bySignal[s] += 1
  }
  return { total: grid.cells.length, empty: byPlace.empty, bySignal, byPlace }
}

/** 该格是否"该层末守卫"（= 下一层入口） */
export function isExitCell(grid: WormholeGridState, cell: HexCell): boolean {
  return grid.exit.q === cell.q && grid.exit.r === cell.r
}

/**
 * **该格的"内容序号"**（0 起）：给 `wormholeCardIdForRun`（族 + 层档位池）抽敌卡用。
 *
 * 旧（线性节点）口径用 `run.nodeIndex` 当序号；网格世界里没有"第几个节点"了，
 * 若继续用常量 0，全层每场战斗都是同一张敌卡（一层里连打三场完全重样）——
 * 故按格坐标散列出序号：**同格恒同序**（可复现）、不同格大体不同（有变化）。
 */
export function gridContentIndex(grid: WormholeGridState, cell: HexCell = grid.pos): number {
  const n = Math.abs(cell.q * 7 + cell.r * 13 + grid.radius * 3)
  return n % 8
}

/** 层末守卫战的用途键（与现有 `WormholeFoeKind` 对齐，F3b 接战斗时直接用） */
export const WORMHOLE_EXIT_KIND: WormholeFoeKind = 'boss'
