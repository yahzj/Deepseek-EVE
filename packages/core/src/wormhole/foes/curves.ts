/** 功能域职责拆分，保持原计算与顺序。 */
import type { AnomalyDef, FoeSupportBranch } from '../../types'
import { resolveFoeMounts } from '../../foeMounts'

/** 第 1 层基准威胁 */
export const WORMHOLE_THREAT_BASE = 45

/**
 * **玩家可见威胁的显示倍率**（船长 2026-09-15：「**虫洞的面板威胁（显示给玩家看的）建议乘以2**，
 * 玩家目前会因为 1 层的 50 威胁出现误判」）。
 *
 * ⚠⚠ **只乘"给人看的那个数字"，绝不动引擎的 `threat`**：洞内的 `threat` 是**血预算的输入**——
 * `foeHpOfThreat(威胁) × WORMHOLE_FOE_BASE_STRENGTH_MUL(10)`（见 `combat.wormholeDerivedAnomaly`），
 * 动它等于把敌人血量整体翻倍 ⇒ 那是**难度改动**，不是显示改动（本常量只服务界面）。
 *
 * 为什么需要它：洞内一张卡的总血 = **单船威胁曲线 × 10**（4 舰对 4 舰口径）⇒ 同样写着"威胁 45"，
 * 洞内的实际体量远大于悬赏线上的同数字卡，玩家按悬赏经验读会误判"50 威胁很轻松"。
 * 一个数可调：要改观感只动本值（界面三处读数全部走 `wormholeDisplayThreat`）。
 */
export const WORMHOLE_DISPLAY_THREAT_MUL = 2

/** **玩家可见的洞内威胁**（显示口径 = 引擎威胁 × `WORMHOLE_DISPLAY_THREAT_MUL`，取整；不参与任何引擎计算） */
export function wormholeDisplayThreat(threat: number): number {
  return Math.round(threat * WORMHOLE_DISPLAY_THREAT_MUL)
}

/**
 * 每层**威胁**增幅（等比 ×1.12 ⇒ 层 1~8 = 45/50/56/63/71/79/89/99）。
 *
 * ⚠ **2026-09-23 船长令：「WORMHOLE_THREAT_GROWTH 上调」⇒ 0.10 → 0.12**（船长原话先说"回调到 1.2"，
 * 随后自行更正为**威胁常量取 0.12**；就"上调敌人强度"的本意落这一档）。
 * 与 2026-09-15 那条「降低虫洞内，敌人的强度增长速度」（0.16 → 0.10）的关系：**该条的口径被本次上调改写**
 * ——0.10 是当时为了拆掉层 7/8 的两堵墙挑出来的档，本次按船长新令回抬到 0.12（仍低于被否掉的 0.16）。
 *
 * 沿革与本档的读数边界（**必读，别拿旧读数当本档的验收**）：
 * - 2026-09-15 实测（4×T3 满配 · 5 播种 · 逐层解析表）——旧 ×1.16 层 7/8 节点胜率 **20% / 0%**；
 *   ×1.12 **墙照旧**（20%/20%）⇒ **那一档的墙主要来自档位阶跃 + 单卡，不是等比曲线**；
 *   ×1.10 才拆墙（层 7 = 100% · 残血 49%；层 8 = 60% · 残血 33%）。
 * - ⚠ 上面那批读数出自**「血量预算」旧口径**；2026-09-16「威胁预算 = 血 × 火力」（`d1ba834d`）
 *   与 09-19 谜质/支援批都在其后，`tools/wormhole-econ.ts` 的参考编队（4×T3 巡 · 技能 Lv3 · 无谜质）
 *   自 2026-09-13 起未再复核 ⇒ **同威胁数字下的实际体量已明显变硬**，本档的成败要等尺子重定后复核。
 * - 2026-10-19：威胁不改，信号空间资源点改为堆数与单堆收益共同增长。
 */
export const WORMHOLE_THREAT_GROWTH = 0.12

/** 2026-10-19确认：单堆层增幅下调，另由signalSpaceResourcePileBonus增加资源堆数。 */
export const WORMHOLE_REWARD_GROWTH = 0.08

/** 兼容取整：每层威胁的**名义**增量（= 45×0.12 = 5.4 ≈ **5**；2026-09-15 由 7 降到 5，
 *  2026-09-23 增幅上调到 0.12 后取整仍为 5；供文档/读数引用） */
export const WORMHOLE_THREAT_PER_LAYER = Math.round(WORMHOLE_THREAT_BASE * WORMHOLE_THREAT_GROWTH)

/** 第depth层威胁：基准值乘现行威胁增长率，不受资源调整影响。 */
export function wormholeLayerThreat(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return Math.round(WORMHOLE_THREAT_BASE * Math.pow(1 + WORMHOLE_THREAT_GROWTH, d - 1))
}

/** 信号空间单堆层收益每层×1.08，实验虫洞保留原线性增长。 */
export function wormholeLayerRewardMul(depth: number, expeditionRules?: number): number {
  const d = Math.max(1, Math.floor(depth))
  if (expeditionRules === 2) return 1 + 0.08 * (d - 1)
  return Math.pow(1 + WORMHOLE_REWARD_GROWTH, d - 1)
}

/** 2026-10-19确认：信号空间每深入一层多一堆矿脉/普通残骸，不扩增实验虫洞。 */
export function signalSpaceResourcePileBonus(depth: number, expeditionRules?: number): number {
  return expeditionRules === undefined ? Math.max(0, Math.floor(depth) - 1) : 0
}

/** 每层节点数（船长定：2~3 个；层 1~2 取 2、层 3 起取 3——越深越长，与收益曲线同向） */
export function wormholeNodesPerLayer(depth: number): number {
  return Math.max(1, Math.floor(depth)) <= 2 ? 2 : 3
}

/** 洞内敌卡的用途：普通节点 / 层末 BOSS / **遗迹收尾战**（威胁倍率与选靶模式按此分流）。
 * ⚠ **`'extract'`（撤离战）已于 2026-09-15 退役**（船长「虫洞的撤离战取消吧」）——
 * 枚举值与下面两条常量**保留只为读得懂老档**（旧战斗的 `kind` 存在存档里），新趟不再产生。 */
export type WormholeFoeKind = 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'

/** 层末 **BOSS** 的威胁倍率（设计稿 §3 表：本层 ×1.2） */
export const WORMHOLE_BOSS_THREAT_MUL = 1.2

/** ⚠ **已退役（2026-09-15 撤离战取消）**：撤离战威胁倍率（旧口径：当层威胁 ×0.8）——只为老档文档留档 */
export const WORMHOLE_EXTRACT_THREAT_MUL = 0.8

/**
 * ⚠ **已退役（2026-09-15 撤离战取消 · 船长「虫洞的撤离战取消吧」）**：撤离战威胁**线性**口径。
 *
 * 旧口径（**只作沿革留档，别再引用**）：**层 2 = 42**（= 层 2 威胁 52 × 0.8），之后**每层 +7**
 * （线性而非等比，船长 2026-09-13 裁定「撤离威胁按线性」）；层 1 没有拦截舰队
 * （旧常量 `WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH = 2`，**已删除**）。
 *
 * 为什么留：老档里**已经在打**的撤离战，其单位在建档那一刻就按本曲线算好了
 * （`UnitSpec` 已固化），本函数只是"当时怎么算的"的出处；**新趟不会再有撤离战**。
 */
export const WORMHOLE_EXTRACT_THREAT_BASE = Math.round(
  WORMHOLE_THREAT_BASE * (1 + WORMHOLE_THREAT_GROWTH) * WORMHOLE_EXTRACT_THREAT_MUL, // 层 2 = round(45×1.12×0.8) = 40（退役常量 · 只为读老档）
)

/** ⚠ **已退役（2026-09-15）**：撤离战每层增量（线性；= 层增量名义值 7） */
export const WORMHOLE_EXTRACT_THREAT_PER_LAYER = WORMHOLE_THREAT_PER_LAYER

/** ⚠ **已退役（2026-09-15）**：第 `depth` 层撤离战威胁（旧读数：层 2 = 42、层 3 = 49 …… 层 8 = 84） */
export function wormholeExtractThreat(depth: number): number {
  const d = Math.max(2, Math.floor(depth))
  return WORMHOLE_EXTRACT_THREAT_BASE + WORMHOLE_EXTRACT_THREAT_PER_LAYER * (d - 2)
}

/** **遗迹收尾战**的威胁倍率（船长：「打捞结束时，大概率会触发一场**高难度**战斗」⇒ 比普通地点战高一档） */
export const WORMHOLE_RUINS_THREAT_MUL = 1.3

/**
 * **敌卡「预设作战口径」的强度系数**（船长 2026-09-25 裁定 ⇒ 定价规则，规则内写死）。
 *
 * 判据 = **这张卡预设给谁打**，与"玩家实际带几条船""敌人编成几艘船"**都无关**（船长原话：
 * 「虫洞不是按照"我方参战舰数"分流，而是这张卡设计是给小队打的，不考虑玩家实际参战舰船数量」）；
 * - `solo = 3`：**单舰**内容 —— 全部洞外常驻悬赏（规则上写死玩家单舰出击）；
 * - `squad = 10`：**4 舰小队**内容 —— 洞内派生卡（= 下方的 `WORMHOLE_FOE_BASE_STRENGTH_MUL`）。
 *
 * 它与 `foeHpOfThreat` 一起构成**威胁 ↔ 属性**的定价式（引擎实测逐层/逐卡核对过）：
 * ```
 * X = √(全波总血 × 全波总火力DPS) = 2 × foeHpOfThreat(威胁) ÷ 10 × 系数
 * ⇒ 威胁 = foeHpOfThreat⁻¹( 5X ÷ 系数 )        （反解函数见 `combat.foeThreatRatingOf`）
 * ```
 * 洞内那一支天然满足：`combat.wormholeDerivedAnomaly` 传 `hpBudget = foeHpOfThreat(威胁) × 10`，
 * `wormholeAnomalyOf` 再算 `budget² / 25` 后开方 ⇒ **X = 2 × foeHpOfThreat(引擎威胁)**
 * （层 1 实测：X 697 = 2 × F(45) = 2 × 349 ✓）。
 *
 * ⚠ **改本表 = 改难度**（属性随系数等比例伸缩）：洞外 23 张常驻悬赏已按 `solo` 重定标威胁值
 * （2026-09-25 重定标批，口径与逐卡对照见 `packages/data/src/anomalies.ts` 的 `ANOMALIES` 头注）。
 */
export const FOE_DESIGN_STRENGTH_MUL = { solo: 3, squad: 10 } as const

/**
 * **洞内敌卡的基准强度系数**（F 批校准旋钮 · 2026-09-13；= 上表的 `squad` 档 · 2026-09-24 起同源）。
 *
 * 含义 = 洞内敌卡的**总血预算**相对"单船威胁曲线"（`foeHpOfThreat(威胁)`）的放大倍数。
 * 为什么需要它：那条曲线是**单船**口径（一张悬赏卡对一艘玩家船），而洞内是 **4 舰对 4 舰**
 * ⇒ 直接用曲线值会让敌人被四倍火力瞬间抹掉（F1 校准实测：第 1~12 层 100% 胜、残血 100%）。
 * 数值由 `tools/wormhole-econ.ts` 按船长 2026-09-13 给的难度基准反推：
 * **参考编队 4×巡洋 MK2 —— 第 1 层轻松打过（允许战损）· 第 2 层战损加重 · 再深有概率损失船**；
 * 改动后必须重跑该工具并把读数写进设计稿。
 */
export const WORMHOLE_FOE_BASE_STRENGTH_MUL = FOE_DESIGN_STRENGTH_MUL.squad

/**
 * **"1 点 DPS 折算多少血"的参考比**（甲案口径 · 船长 2026-09-16：
 * 「预算不应该只看血量，应该直接考虑血/火力比，或者两个一起看」）。
 *
 * 洞内预算 = **威胁量 T = 血 × 火力**（≈ 敌人被打死前能打出的总伤害），并按本比值给"血/火力"定标：
 * `血 = √(T × r)`、`火力 = √(T / r)`（`r` = 该卡**自然**的血/火力比，性格由此保留）。
 * 取 25 = 洞外主力卡的常见比（幽灵舰信号 21.8 · 虚海守望者 34.4 · 穹顶守卫 45.2 · 记 25 为中枢），
 * 它只决定"血与火力各拿多少"，**总量由威胁预算 T 决定**（层难度曲线仍在，见 `WORMHOLE_FOE_BASE_STRENGTH_MUL`）。
 */
export const WORMHOLE_THREAT_REF_RATIO = 25

/** 某张敌卡的**自然总血**（按编成条目的舰级绝对值 × 条数，不含派生缩放）。
 *
 * ⚠ **互斥支援分支只记一支**（2026-09-19「支援呼叫装置」批）：卡里两支（`enterBranch` = inside /
 * outside）**只会到场一支** ⇒ 若把两支都算进"自然总血"，没到场的那支会白占预算，
 * 本卡会比同层同档的其它卡弱一截（实测两侧都算 = 弱约 24%），破「同层同档血×火力恒等」红线。
 * 取**较重的一支**记账（两支账面相等由体检守恒契约钉住）⇒ 到场后总量恰为该层预算。 */
export function wormholeNaturalHp(base: AnomalyDef): number {
  const skip = wormholeSkippedBranch(base)
  return (base.ships ?? [])
    .filter((s) => skip === null || s.enterBranch === undefined || s.enterBranch !== skip)
    .reduce(
      (n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
      0,
    )
}

/** 某一个支援分支的**自然总血**（含条目倍率与条数；体检守恒契约与"取重者记账"共用） */
export function wormholeBranchNaturalHp(base: AnomalyDef, branch: FoeSupportBranch): number {
  return (base.ships ?? [])
    .filter((s) => s.enterBranch === branch)
    .reduce(
      (n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
      0,
    )
}

/**
 * **互斥支援分支里"较轻"的那一支**（`null` = 本卡没有互斥分支 ⇒ 一切照旧、零行为变化）。
 *
 * 判据 = **自然总血**（两支账面相等是体检契约，故取重者是确定且无歧义的）；
 * `wormholeNaturalHp` 不计这一支，`combat` 侧的 `naturalDps` 用同一个函数排除同一支
 * （两处必须同源，否则血与火力的口径会打架）。
 */
export function wormholeSkippedBranch(base: AnomalyDef): FoeSupportBranch | null {
  const ships = base.ships ?? []
  const hasIn = ships.some((s) => s.enterBranch === 'inside')
  const hasOut = ships.some((s) => s.enterBranch === 'outside')
  if (!hasIn || !hasOut) return null
  return wormholeBranchNaturalHp(base, 'inside') >= wormholeBranchNaturalHp(base, 'outside')
    ? 'outside'
    : 'inside'
}

/**
 * 本层本次交战的**威胁**（普通节点 = 层威胁；BOSS ×1.2；**撤离战 = 线性曲线**；遗迹收尾战 ×1.3）
 */
export function wormholeFoeThreat(depth: number, kind: WormholeFoeKind): number {
  const base = wormholeLayerThreat(depth)
  if (kind === 'boss') return Math.round(base * WORMHOLE_BOSS_THREAT_MUL)
  if (kind === 'extract') return wormholeExtractThreat(depth)
  if (kind === 'ruins') return Math.round(base * WORMHOLE_RUINS_THREAT_MUL)
  return base
}

/**
 * **支援呼叫装置的延迟补偿倍率**（船长 2026-09-19：「因为延迟到场，所以需要一定补偿。
 * **卡计算的实际威胁要*1.1**」；口径取「**甲**」= 照字面乘在**威胁**上）。
 *
 * 本卡任一编成条目（**有效挂载** = 条目 `mounts` ?? 舰级 `ship.mounts`）挂了
 * `FoeMountDef.supportCall` ⇒ 取它的 `threatMul`（多件取**最大**；正常只有一件）。
 * 没有该件的卡一律返回 **1** ⇒ 全表其余 14 张洞内卡与洞外一切卡**逐字零变化**。
 */
export function wormholeCardThreatMul(base: AnomalyDef): number {
  let mul = 1
  for (const s of base.ships ?? []) {
    const sc = resolveFoeMounts(s.mounts ?? s.ship.mounts).foeSupportCall
    if (sc !== undefined && sc.threatMul > mul) mul = sc.threatMul
  }
  return mul
}

/**
 * **本卡本层本次交战的"实际威胁"**（含支援呼叫装置的延迟补偿）——**显示与预算同源**：
 * `wormholeAnomalyOf` 用它写派生卡的 `threat`，`combat.wormholeDerivedAnomaly` 用它算 `hpBudget`
 * ⇒ **同一个取整后的数**既是对玩家显示的威胁、也是战力标尺的输入
 * （「威胁 = 战力标尺」在本卡上依旧成立；该链上血与火力各 ×约 1.16）。
 */
export function wormholeCardThreatOf(
  base: AnomalyDef,
  depth: number,
  kind: WormholeFoeKind,
): number {
  return Math.round(wormholeFoeThreat(depth, kind) * wormholeCardThreatMul(base))
}
