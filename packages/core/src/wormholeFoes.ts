/**
 * **终局玩法「虫洞」· 层曲线与洞内敌卡派生**（F 批 · 2026-09-13）。
 *
 * 拆成独立模块的原因：本文件被**引擎（`combat.ts` 的 `advanceBattleFor`）**与**副本状态机
 * （`wormhole.ts`）**同时需要，而 `combat.ts` 不能反向依赖 `wormhole.ts`（状态机里有大量副本语义）。
 * 依赖方向固定为：`wormholeFoes.ts`（纯函数，只吃类型） ← `wormhole.ts` / `combat.ts`。
 *
 * 口径：设计稿 `docs/design/wormhole-extraction-endgame-20260912.md`
 * §3（节点/层末 BOSS 表）· §4（威胁与收益曲线）· §九 Q11（收益涨得比难度快）。
 */
import type { AnomalyDef, DamageType, FoeShipSlot, FoeSupportBranch, FoeTargetingMode, SimContext } from './types'
import type { WormholeFamily } from './state'
import { foeDamageComposition } from './combat'
import { resolveFoeMounts } from './foeMounts'

/* ═══════════ 一、层曲线（威胁 / 收益） ═══════════ */

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
 * - 基准层 1 = 45 **不动**；收益曲线（`WORMHOLE_REWARD_GROWTH` = 0.20）**不动** ⇒ 0.12 < 0.20，
 *   「单位威胁收益逐层严格上升」（船长 2026-09-13）**仍然成立**，用例 `wormhole-run.test.ts` 照旧守着。
 */
export const WORMHOLE_THREAT_GROWTH = 0.12
/** 每层**收益**增幅（等比 ×1.2）。**必须大于威胁增幅** —— 船长 2026-09-13：
 *  「深层收益应该比难度曲线要更高」⇒ 用等比而非加法，才能让"单位威胁收益"**逐层严格上升**
 *  （若威胁用 +9 加法，层 1→2 的威胁增幅恰好 20%、与收益打平，头两层看不出"更赚"）。
 *  2026-09-15 威胁增幅降到 0.10 后，这条不等式更宽松（收益 0.20 > 威胁 0.10）。 */
export const WORMHOLE_REWARD_GROWTH = 0.2
/** 兼容取整：每层威胁的**名义**增量（= 45×0.12 = 5.4 ≈ **5**；2026-09-15 由 7 降到 5，
 *  2026-09-23 增幅上调到 0.12 后取整仍为 5；供文档/读数引用） */
export const WORMHOLE_THREAT_PER_LAYER = Math.round(WORMHOLE_THREAT_BASE * WORMHOLE_THREAT_GROWTH)

/** 第 `depth` 层的威胁（层 1 = 45，每层 ×1.10，取整） */
export function wormholeLayerThreat(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return Math.round(WORMHOLE_THREAT_BASE * Math.pow(1 + WORMHOLE_THREAT_GROWTH, d - 1))
}

/** 第 `depth` 层的收益系数（层 1 = 1.0，每层 ×1.2）——**涨得比威胁快** */
export function wormholeLayerRewardMul(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return Math.pow(1 + WORMHOLE_REWARD_GROWTH, d - 1)
}

/** 每层节点数（船长定：2~3 个；层 1~2 取 2、层 3 起取 3——越深越长，与收益曲线同向） */
export function wormholeNodesPerLayer(depth: number): number {
  return Math.max(1, Math.floor(depth)) <= 2 ? 2 : 3
}

/* ═══════════ 二、洞内敌卡派生（按层换算威胁） ═══════════ */

/** 洞内敌卡的用途：普通节点 / 层末 BOSS / **遗迹收尾战**（威胁倍率与选靶模式按此分流）。
 * ⚠ **`'extract'`（撤离战）已于 2026-09-15 退役**（船长「虫洞的撤离战取消吧」）——
 * 枚举值与下面两条常量**保留只为读得懂老档**（旧战斗的 `kind` 存在存档里），新趟不再产生。 */
export type WormholeFoeKind = 'node' | 'boss' | 'extract' | 'ruins'

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
 * **洞内敌卡的基准强度系数**（F 批校准旋钮 · 2026-09-13）。
 *
 * 含义 = 洞内敌卡的**总血预算**相对"单船威胁曲线"（`foeHpOfThreat(威胁)`）的放大倍数。
 * 为什么需要它：那条曲线是**单船**口径（一张悬赏卡对一艘玩家船），而洞内是 **4 舰对 4 舰**
 * ⇒ 直接用曲线值会让敌人被四倍火力瞬间抹掉（F1 校准实测：第 1~12 层 100% 胜、残血 100%）。
 * 数值由 `tools/wormhole-econ.ts` 按船长 2026-09-13 给的难度基准反推：
 * **参考编队 4×巡洋 MK2 —— 第 1 层轻松打过（允许战损）· 第 2 层战损加重 · 再深有概率损失船**；
 * 改动后必须重跑该工具并把读数写进设计稿。
 */
export const WORMHOLE_FOE_BASE_STRENGTH_MUL = 10

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

/**
 * 洞内敌卡的**逐卡清单**（与 `packages/data/src/wormholeFoes.ts` 的卡表**同序**）。
 * ⚠ 三处必须逐字同序：本表 / data 卡表 / `content:check` 的洞内清单——体检有契约钉住。
 *
 * 2026-09-13 五张（A/C/D/E/G 各一）；**2026-09-15 扩充**（船长「增加敌人的配置种类和敌族新舰船」）：
 * 五族各出**浅/中/深三档**（共 15 张）。本表按"浅层五张（**旧 id 不变**）→ 各族中/深"追加
 * ⇒ 旧索引不变、老档零迁移。
 */
export const WORMHOLE_FOE_CARD_IDS: readonly string[] = [
  // —— 浅层五张（2026-09-13 落码 · id 与卡名沿用；编成按 2026-09-15 裁定改） ——
  'wh-pirate-scout',
  'wh-alien-swarm',
  'wh-grave-watch',
  'wh-exile-blockade',
  'wh-titan-echo',
  // —— 中层 / 深层（2026-09-15 扩充：批 1 A 族 · 批 2 C 族 · 批 3 D 族 · 批 4 E 族 · 批 5 G 族） ——
  'wh-pirate-hunt',
  'wh-pirate-warband',
  'wh-alien-brood',
  'wh-alien-hive',
  'wh-grave-sentry',
  'wh-grave-throne',
  'wh-titan-missile',
  'wh-titan-hulk',
  'wh-exile-swarm',
  'wh-exile-line',
]

/* ═══════════ 档位 · 出场池 · 分层血量修正（船长 2026-09-15） ═══════════ */

/** 洞内敌卡的**档位**（浅/中/深）——决定出场层、出场权重与血量修正 */
export type WormholeCardTier = 'shallow' | 'mid' | 'deep'

/** 档位枚举（顺序 = 由浅入深；界面读数 / 用例 / 契约共用一处） */
export const WORMHOLE_CARD_TIERS: readonly WormholeCardTier[] = ['shallow', 'mid', 'deep']

/** 档位中文名（读数与日志用） */
export const WORMHOLE_TIER_LABEL: Readonly<Record<WormholeCardTier, string>> = {
  shallow: '浅层',
  mid: '中层',
  deep: '深层',
}

/** **出场层**（船长 2026-09-15：「浅层中层深层分别定为 1/2/4 层开始出现」） */
export const WORMHOLE_TIER_UNLOCK_DEPTH: Readonly<Record<WormholeCardTier, number>> = {
  shallow: 1,
  mid: 2,
  deep: 4,
}

/**
 * **分层"威胁预算"修正**（2026-09-16 船长改口径：「**档位血量修正改为威胁预算修正，比例降为 1 : 1.05 : 1.1**」）。
 *
 * 沿革：2026-09-15 是"**只乘血**"的 1 / 1.1 / 1.2（"更耐打、不更疼"）；改用"威胁预算（血 × 火力）"
 * 口径后，这道修正乘在**威胁预算 T** 上 ⇒ 血与火力按同一比例一起抬（中 ×1.05、深 ×1.1），
 * 而不是只抬血。取值也按船长本次裁定降档：**浅 1 / 中 1.05 / 深 1.1**。
 */
export const WORMHOLE_TIER_THREAT_MUL: Readonly<Record<WormholeCardTier, number>> = {
  shallow: 1,
  mid: 1.05,
  deep: 1.1,
} 

/**
 * 该层的**出场权重表**（船长 2026-09-15：「层 2~3出场抽取按照 2:1 抽。层4+出场抽取按照 2:1：1 抽」）：
 * 层 1 = 浅 1 / 层 2~3 = **中 2 : 浅 1** / 层 4+ = **深 2 : 中 1 : 浅 1**。
 * 读法 = **新解锁的那一档占一半权重**（层 2~3 的中、层 4+ 的深）；权重只在**已有卡**之间归一。
 */
export function wormholeTierWeightsAt(depth: number): Readonly<Record<WormholeCardTier, number>> {
  const d = Math.max(1, Math.floor(depth))
  if (d <= 1) return { shallow: 1, mid: 0, deep: 0 }
  if (d <= 3) return { shallow: 1, mid: 2, deep: 0 }
  return { shallow: 1, mid: 1, deep: 2 }
}

/**
 * 某族某层的**出场池**（缺档剔除、其余权重不变；全缺 ⇒ 退回现有最深一张）。
 * **分批上线期间靠这条兜底**：某族还没做出中层卡时，层 2~3 就只出浅层卡，不会开不出战。
 */
export function wormholeCardPoolAt(
  family: WormholeFamily,
  depth: number,
): Array<{ id: string; tier: WormholeCardTier; weight: number }> {
  const w = wormholeTierWeightsAt(depth)
  const out: Array<{ id: string; tier: WormholeCardTier; weight: number }> = []
  for (const t of WORMHOLE_CARD_TIERS) {
    const id = WORMHOLE_FAMILY_CARDS[family][t]
    if (id !== null && w[t] > 0) out.push({ id, tier: t, weight: w[t] })
  }
  if (out.length > 0) return out
  const deepest = [...WORMHOLE_CARD_TIERS].reverse().find((t) => WORMHOLE_FAMILY_CARDS[family][t] !== null)
  const id = deepest ? WORMHOLE_FAMILY_CARDS[family][deepest]! : WORMHOLE_FAMILY_CARD[family]
  return [{ id, tier: deepest ?? 'shallow', weight: 1 }]
}

/** 层末守卫用**该层最深已解锁档**的卡（层 1 浅 / 层 2~3 中 / 层 4+ 深；该档缺 ⇒ 退次深） */
export function wormholeGuardCardOf(family: WormholeFamily, depth: number): string {
  const d = Math.max(1, Math.floor(depth))
  for (const t of [...WORMHOLE_CARD_TIERS].reverse()) {
    if (WORMHOLE_TIER_UNLOCK_DEPTH[t] <= d && WORMHOLE_FAMILY_CARDS[family][t] !== null) {
      return WORMHOLE_FAMILY_CARDS[family][t]!
    }
  }
  return WORMHOLE_FAMILY_CARD[family]
}

/**
 * **本场用哪张敌卡**（唯一取值点 · 2026-09-15 取代旧"全表轮换"）：
 * - **层末守卫** ⇒ 该层最深已解锁档（`wormholeGuardCardOf`）；
 * - **其余用途**（节点 / 撤离 / 遗迹）⇒ 按该层出场池 + `(种子, 层, 序号)` **确定性**权重轮盘抽取
 *   ⇒ 同格恒同卡、读档不变、可复现。
 */
export function wormholeCardIdForRun(spec: {
  family?: WormholeFamily
  seed?: number
  depth: number
  kind: WormholeFoeKind
  /** 节点序号（网格层 = `gridContentIndex(grid, cell)`；线性老档 = `run.nodeIndex`） */
  nodeIndex?: number
}): string {
  const family = spec.family ?? wormholeFamilyOfSeed(spec.seed ?? 1)
  if (spec.kind === 'boss') return wormholeGuardCardOf(family, spec.depth)
  const pool = wormholeCardPoolAt(family, spec.depth)
  const total = pool.reduce((n, e) => n + e.weight, 0)
  if (total <= 0) return WORMHOLE_FAMILY_CARD[family]
  const seed = Math.abs(Math.floor(spec.seed ?? 1)) % 1_000_000_007
  const d = Math.max(1, Math.floor(spec.depth))
  const i = Math.max(0, Math.floor(spec.nodeIndex ?? 0))
  const h = Math.abs((seed * 1103515245 + (d * 97 + i) * 12345) % 2147483647)
  let r = h % total
  for (const e of pool) {
    if (r < e.weight) return e.id
    r -= e.weight
  }
  return pool[pool.length - 1]!.id
}

/** 卡 id → 档位（查不到 = `null`）。**档位由卡表决定、不落存档** ⇒ 老档零迁移 */
export function wormholeTierOfCard(cardId: string | null | undefined): WormholeCardTier | null {
  if (!cardId) return null
  for (const f of WORMHOLE_FAMILY_ORDER) {
    for (const t of WORMHOLE_CARD_TIERS) {
      if (WORMHOLE_FAMILY_CARDS[f][t] === cardId) return t
    }
  }
  return null
}

/** 某族某档的卡 id（该档缺 = `null`） */
export function wormholeCardOfTier(family: WormholeFamily, tier: WormholeCardTier): string | null {
  return WORMHOLE_FAMILY_CARDS[family][tier]
}

/** 卡表里已登记的**全部卡 id**（浅→深、族按 `WORMHOLE_FAMILY_ORDER`；用例与读数工具用） */
export function wormholeAllCardIds(): string[] {
  return WORMHOLE_FAMILY_ORDER.flatMap((f) =>
    WORMHOLE_CARD_TIERS.map((t) => WORMHOLE_FAMILY_CARDS[f][t]).filter((x): x is string => x !== null),
  )
}

/* ═══════════ 敌族锁定（丁 · 船长 2026-09-14 定案；2026-09-15 扩到三档） ═══════════ */

/** 五族（抽取顺序；等概率） */
export const WORMHOLE_FAMILY_ORDER: readonly WormholeFamily[] = ['A', 'C', 'D', 'E', 'G']

/**
 * **族 → 三档卡**（浅/中/深；`null` = 该档还没做出来 ⇒ 出场池自动跳过）。
 * 分批上线期间允许缺档：**缺档就从池里剔除、其余权重不变**（见 `wormholeCardPoolAt`）。
 */
export const WORMHOLE_FAMILY_CARDS: Readonly<
  Record<WormholeFamily, Readonly<Record<WormholeCardTier, string | null>>>
> = {
  A: { shallow: 'wh-pirate-scout', mid: 'wh-pirate-hunt', deep: 'wh-pirate-warband' },
  C: { shallow: 'wh-alien-swarm', mid: 'wh-alien-brood', deep: 'wh-alien-hive' },
  D: { shallow: 'wh-grave-watch', mid: 'wh-grave-sentry', deep: 'wh-grave-throne' },
  E: { shallow: 'wh-titan-echo', mid: 'wh-titan-missile', deep: 'wh-titan-hulk' },
  G: { shallow: 'wh-exile-blockade', mid: 'wh-exile-swarm', deep: 'wh-exile-line' },
}

/** 缺档兜底的底牌（正常路径永不用到；只为"族表被写坏"时不至于返回空 id） */
const WORMHOLE_CARD_FALLBACK = 'wh-pirate-scout'

/** 族徽色调（界面用；与 `Glyphs.tsx` 的 `fam-*` 徽记同键） */
export const WORMHOLE_FAMILY_GLYPH: Readonly<Record<WormholeFamily, string>> = {
  A: 'fam-a',
  C: 'fam-c',
  D: 'fam-d',
  E: 'fam-e',
  G: 'fam-g',
}

/**
 * **族 → 浅层卡**（= 三档表的浅档）。
 *
 * 保留这个名字是因为既有调用点只关心"这是哪个族"，不关心用哪一档：
 * 族名显示（`engine.wormholeFamilyName`）· 打捞产出按族（`wormholeCellCardIdOf`）·
 * 自动探索的残骸物品口径（`wormholeAuto`）· 老档兜底 —— 它们**一律取浅层卡**，
 * 与"这一场战斗用哪一档"（`wormholeCardIdForRun`）解耦。
 */
export const WORMHOLE_FAMILY_CARD: Readonly<Record<WormholeFamily, string>> = {
  A: WORMHOLE_FAMILY_CARDS.A.shallow ?? WORMHOLE_CARD_FALLBACK,
  C: WORMHOLE_FAMILY_CARDS.C.shallow ?? WORMHOLE_CARD_FALLBACK,
  D: WORMHOLE_FAMILY_CARDS.D.shallow ?? WORMHOLE_CARD_FALLBACK,
  E: WORMHOLE_FAMILY_CARDS.E.shallow ?? WORMHOLE_CARD_FALLBACK,
  G: WORMHOLE_FAMILY_CARDS.G.shallow ?? WORMHOLE_CARD_FALLBACK,
}

/**
 * **一处虫洞锁定的敌族**（确定性：同 `seed` 必得同族，**等概率**五分之一）。
 * 老档/调试入口没有该字段 ⇒ 现算，永远一致、不重掷。
 *
 * ⚠ **2026-09-16 修真 BUG（船长确认修）**：旧实现是
 * `Math.abs((s × 1103515245 + 12345) % WORMHOLE_FAMILY_ORDER.length)`，
 * 而 `1103515245 = 5 × 220703049`、`12345 = 5 × 2469` **两项都能被 5 整除**
 * ⇒ 整个和恒 `≡ 0 (mod 5)` ⇒ 下标恒 0 ⇒ **任何种子的族都是 A（海盗）**：
 * 五族里另外四族（连同它们的洞内敌卡、族专属装备/图纸/舰船）**实际永不出现**
 * （实测：种子 1..20000 → 100% A）。根因 = 那对 LCG 常数本是配 `% 2^31` 用的，
 * 拿来配 `% 5` 时"乘数/加数与模数不互质"，结果塌成一个常数。
 *
 * 修法：换成 splitmix 风格的 **32 位混合**（全程 `Math.imul`/异或 ⇒ 无浮点精度损失、
 * 跨引擎确定），再取模。修后：新旧存档里**已有的洞不变**（族随 `run.family` 落档），
 * 只有"现算"的入口（新扫描的洞 / 老档缺字段 / 调试入口）会真正摇出五族。
 */
function mix32(x: number): number {
  let v = x >>> 0
  v = Math.imul(v ^ (v >>> 16), 2246822507)
  v = Math.imul(v ^ (v >>> 13), 3266489909)
  v ^= v >>> 16
  return v >>> 0
}

export function wormholeFamilyOfSeed(seed: number): WormholeFamily {
  const s = Math.abs(Math.floor(seed)) % 1_000_000_007
  const h = mix32(s) % WORMHOLE_FAMILY_ORDER.length
  return WORMHOLE_FAMILY_ORDER[h]!
}

/**
 * **族的中文族名**（界面用；船长 2026-09-16：「扫描虫洞界面…给虫洞卡片添加更多信息
 * （虫洞内是什么敌人，以什么类型伤害为主）」）。
 *
 * ⚠ 与 `WORMHOLE_FAMILY_CARD`（**浅层卡名**，如「劫掠支队」）是**两样东西**：这里是**族称**
 * （海盗 / 异形 / 守墓 / 巨构 / 亡军），与设计稿和词典里的族格叫法一致。
 * 这几个词在玩家可见文本里本就存在（卡名「海盗战团」「亡军封锁」等），不算新造词。
 */
export const WORMHOLE_FAMILY_ETHNIC: Readonly<Record<WormholeFamily, string>> = {
  A: '海盗',
  C: '异形',
  D: '守墓',
  E: '巨构',
  G: '亡军',
}

/** 伤害类型的中文名（与战斗界面 `DMG_LABEL` 同一套叫法：动能 / 高爆 / 能量） */
export const DAMAGE_TYPE_LABELS: Readonly<Record<DamageType, string>> = {
  kinetic: '动能',
  explosive: '高爆',
  plasma: '能量',
}

/**
 * **一族的"敌情"摘要**（船长 2026-09-16 定的显示口径：**卡片给族级一句话 + 悬停列三档**）。
 *
 * - `ethnic`：族称（海盗 / 异形 / …）；`firstCardName`：玩家最先碰到的**浅层卡名**（现有单点 `WORMHOLE_FAMILY_CARD`）；
 * - `primaryText`：**主系一句话**，按**浅层卡**的 `dmgMix` 推：单系 ⇒ 「纯高爆」·
 *   头名 ≥ 75% ⇒ 「动能为主」· 否则 ⇒ 「动能 / 高爆并重」（E 族浅层 5:5 就是这一档）；
 * - `tiers`：**浅/中/深三档各自的卡名与火力构成**（构成取 `foeDamageComposition`，与战斗结算、胜率预估同源
 *   ⇒ 卡面不会与实战脱节）。⚠ **档间会变**：D 族深层是 6:4、E 族中层是纯爆炸 —— 卡片那行只报族级（浅层），
 *   差异写进悬停（船长选的「卡片族级 + 悬停列三档」）。
 */
export interface WormholeFamilyIntel {
  family: WormholeFamily
  ethnic: string
  firstCardId: string
  firstCardName: string
  primaryText: string
  /**
   * **主系一句话的结构化形态**（甲案 2026-09-20）：渲染层按它组当前语言的句子。
   * `primaryText` 保留为中文原串（老调用点/回退用）。
   * - `pure`：单系 ⇒「纯{p1}」· `main`：头名 ≥75% ⇒「{p1}为主」· `mixed`：⇒「{p1} / {p2}并重」
   */
  primaryKind: 'pure' | 'main' | 'mixed'
  primaryTypeA: DamageType
  primaryTypeB?: DamageType
  tiers: ReadonlyArray<{
    tier: WormholeCardTier
    cardId: string
    cardName: string
    parts: ReadonlyArray<{ type: DamageType; share: number }>
  }>
}

/** 三档的**显示顺序与中文名**（浅 → 中 → 深；与 `WORMHOLE_CARD_TIERS` 同集合）。
 *  甲案 id：浅/中/深 = `core.wormholeFoes.001/.002/.003`（渲染层按它取当前语言）。 */
export const WORMHOLE_TIER_LABELS: Readonly<Record<WormholeCardTier, string>> = {
  shallow: '浅层',
  mid: '中层',
  deep: '深层',
}

/** 伤害类型的**中文名 id**（与 `DAMAGE_TYPE_LABELS` 同集合；甲案 2026-09-20） */
export const DAMAGE_TYPE_LABEL_IDS: Readonly<Record<DamageType, string>> = {
  kinetic: 'core.wormholeFoes.004',
  explosive: 'core.wormholeFoes.005',
  plasma: 'core.wormholeFoes.006',
}

/** 族称的中文名 id（与 `WORMHOLE_FAMILY_ETHNIC` 同集合；甲案 2026-09-20） */
export const WORMHOLE_FAMILY_ETHNIC_IDS: Readonly<Record<WormholeFamily, string>> = {
  A: 'core.wormholeFoes.007',
  C: 'core.wormholeFoes.008',
  D: 'core.wormholeFoes.009',
  E: 'core.wormholeFoes.010',
  G: 'core.wormholeFoes.011',
}

/**
 * 取一族的敌情摘要（`ctx.anomalies` **必须是全表**——五张洞内卡都 `hidden`，
 * 用过滤后的目录会拿不到卡名，退回 id；这条坑见 `engine.wormholeFamilyName` 的注释）。
 */
export function wormholeFamilyIntel(family: WormholeFamily, ctx: SimContext): WormholeFamilyIntel {
  const nameOf = (id: string): string => ctx.anomalies.get(id)?.name ?? id
  const tiers = WORMHOLE_CARD_TIERS.map((tier) => {
    const cardId = WORMHOLE_FAMILY_CARDS[family][tier] ?? WORMHOLE_CARD_FALLBACK
    const card = ctx.anomalies.get(cardId)
    return {
      tier,
      cardId,
      cardName: nameOf(cardId),
      parts: card ? foeDamageComposition(card) : [{ type: 'kinetic' as DamageType, share: 1 }],
    }
  })
  const shallow = tiers[0]!
  const parts = shallow.parts
  const typeA: DamageType = parts[0]?.type ?? 'kinetic'
  const primaryKind: 'pure' | 'main' | 'mixed' = parts.length <= 1 ? 'pure' : parts[0]!.share >= 0.75 ? 'main' : 'mixed'
  const primaryText =
    primaryKind === 'pure'
      ? `纯${DAMAGE_TYPE_LABELS[typeA]}`
      : primaryKind === 'main'
        ? `${DAMAGE_TYPE_LABELS[typeA]}为主`
        : `${DAMAGE_TYPE_LABELS[typeA]} / ${DAMAGE_TYPE_LABELS[parts[1]!.type]}并重`
  return {
    family,
    ethnic: WORMHOLE_FAMILY_ETHNIC[family],
    firstCardId: shallow.cardId,
    firstCardName: shallow.cardName,
    primaryText,
    primaryKind,
    primaryTypeA: typeA,
    ...(primaryKind === 'mixed' ? { primaryTypeB: parts[1]!.type } : {}),
    tiers,
  }
}

/** **本趟/本处的敌卡**（族锁定后整趟一张卡；`family` 缺省 ⇒ 按种子现算；两者都缺 ⇒ 按 1 兜底） */
export function wormholeCardIdOfFamily(family: WormholeFamily | undefined, seed: number | undefined): string {
  return WORMHOLE_FAMILY_CARD[family ?? wormholeFamilyOfSeed(seed ?? 1)]
}

/**
 * **层末守卫的选靶倾向概率**（船长 2026-09-14：「**虫洞敌人的攻击倾向，加一个概率**」→ 先定 60%，
 * 同日二次改判「**概率降为40%试一下**」）——BOSS 的**模式**仍是「打最大的」（2026-09-13 定的分流），
 * 变的只是"不再每发都精准"：每发开火前掷一次，没掷中 ⇒ 退回随机。
 *
 * ⚠ 普通节点/撤离战用**卡上**的 `foeTargetingChance`（本次也是 0.4）；这一个常量只管 BOSS。
 */
export const WORMHOLE_BOSS_TARGETING_CHANCE = 0.4

/**
 * **族定选靶**（船长 2026-09-15：「选靶按照族限定。」）——**同族各卡一律用族定模式**，
 * 不再逐卡自定义（此前逐卡写法作废）：
 *
 * | 族 | 模式 | 设定 |
 * |---|---|---|
 * | A 海盗 | `noncombat` | 抢货船 |
 * | C 异形 | `smallest` | 捕食弱者 |
 * | D 守墓 | `top-output` | 残余程序压制火力 |
 * | E 巨构 | `random` | 平台随机投送机群（族格） |
 * | G 鱿烬 | `random` | 蜂群乱战 |
 *
 * 派生端（`wormholeAnomalyOf`）以**本表**为准取模式 ⇒ 卡面字段写错也不会跑偏；
 * `content:check` 与用例另行断言"卡面 = 族定值"。层末守卫仍是 `largest`（既有裁定，不受族限）。
 */
export const WORMHOLE_FAMILY_TARGETING: Readonly<Record<WormholeFamily, FoeTargetingMode>> = {
  A: 'noncombat',
  C: 'smallest',
  D: 'top-output',
  E: 'random',
  G: 'random',
}

/** 族定选靶的**倾向概率**（只有非随机模式消费；沿用船长 2026-09-14 定的 0.4） */
export const WORMHOLE_FAMILY_TARGETING_CHANCE = 0.4

/**
 * **把洞内敌卡按层派生**（不改数据文件，与窝点派生 `lairAnomalyOf` 同款做法）：
 * - 威胁：`wormholeFoeThreat(depth, kind)` × **本卡补偿**（`wormholeCardThreatOf`——挂了「支援呼叫装置」
 *   的卡另有 ×`threatMul`，其它卡逐字不变）；
 * - 舰级路径的**绝对值缩放**：按「锚点威胁 → 目标威胁」的比例同乘每个条目的 `hpMul` / `dmgMul`
 *   （保住"威胁 = 战力标尺"；单发/射程/编成/战术一律不动）；
 * - **波数**：节点的 `waves` 表达"同一编成分 N 波进场" ⇒ 血与火力各摊 `1/N`、按 `slot.wave` 分波
 *   （总战力守恒，与设计稿 §3 表"同一威胁带里分几波"一致）；
 * - **选靶模式**（船长 2026-09-13 定，**2026-09-15 改为「按族限定」**）：普通用途一律取**族定模式**
 *   （`WORMHOLE_FAMILY_TARGETING`；卡面字段只作展示与体检断言）；**BOSS 一律「打最大的」**；
 * - **选靶倾向概率**（船长 2026-09-14 定 0.4）：非随机族取 `WORMHOLE_FAMILY_TARGETING_CHANCE`（0.4），
 *   随机族不掷骰（恒 1）；BOSS 取 `WORMHOLE_BOSS_TARGETING_CHANCE`。
 * 旧路径卡（没写 `ships`）不缩放条目，只改 `threat`（曲线自己会算血与火力）。
 */
export function wormholeAnomalyOf(
  base: AnomalyDef,
  depth: number,
  kind: WormholeFoeKind,
  waves: number,
  /**
   * - `hpBudget`：**本层本档的"血尺度"**（= `foeHpOfThreat(层威胁) × WORMHOLE_FOE_BASE_STRENGTH_MUL`，
   *   由引擎算好传进来，含谜质威胁乘数；不给 = 用本卡的"自然总血"）——新口径下它经平方化成**威胁预算 T**。
   * - `strengthMul`：**校准用覆写**（只有 `tools/wormhole-econ.ts` 会传；引擎/实战一律走常量）。
   * - `tierThreatMul`：**分层威胁预算修正**（浅 1 / 中 1.05 / 深 1.1，见 `WORMHOLE_TIER_THREAT_MUL`）。
   * - `naturalDps`：该卡**自然总火力**（含机群；由调用方按 `createFoeSpecs` 算好传入）——
   *   决定卡的"自然血/火力比 `r`"。缺省 ⇒ 退回 `WORMHOLE_THREAT_REF_RATIO`（等价于"比 = 参考比"）。
   */
  opts?: { hpBudget?: number; strengthMul?: number; tierThreatMul?: number; naturalDps?: number },
): AnomalyDef {
  /**
   * **族定选靶**（船长 2026-09-15「选靶按照族限定」）：族字母可取到就按族表取，
   * 取不到（B/F 等非洞内族，正常路径不该出现）退回卡面字段 ?? 随机 —— **零行为变化**兜底。
   */
  const fam = base.foeFamily
  const familyTargeting: FoeTargetingMode =
    fam !== undefined && fam in WORMHOLE_FAMILY_TARGETING
      ? WORMHOLE_FAMILY_TARGETING[fam as WormholeFamily]
      : (base.foeTargeting ?? 'random')
  const target = wormholeCardThreatOf(base, depth, kind)
  const natural = Math.max(1, wormholeNaturalHp(base))
  const budget = (opts?.hpBudget ?? natural) * (opts?.strengthMul ?? 1)
  /**
   * **2026-09-16 船长改口径（甲案）：「预算不应该只看血量，应该直接考虑血/火力比，或者两个一起看」**
   * ⇒ 预算从"总血"改成**威胁量** `T = 血 × 火力`（≈ 敌人被打死前能打出的总伤害），
   * 卡的自然血/火力比 `r` **原样保留**，血与火力按 `血 = √(T·r)`、`火力 = √(T/r)` 反算：
   * - 层难度曲线仍在：`T = budget² ÷ WORMHOLE_THREAT_REF_RATIO`（budget 已含曲线 ×10 与谜质）；
   * - 档位修正改乘 **T**（浅 1 / 中 1.05 / 深 1.1）⇒ 血与火力**一起**抬，而不是只抬血；
   * - **族系数全部撤除**（D 族的"厚血低伤"由它自己的自然比表达，不再需要专用旋钮）。
   * 效果（改前 → 改后）：15 张卡的"血 × 火力"极差由 **7.69× → 1.00×**（同层同档内恒等）。
   */
  const ratio = opts?.naturalDps !== undefined && opts.naturalDps > 0 ? natural / opts.naturalDps : WORMHOLE_THREAT_REF_RATIO
  const threatBudget = ((budget * budget) / WORMHOLE_THREAT_REF_RATIO) * (opts?.tierThreatMul ?? 1)
  const hpTarget = Math.sqrt(threatBudget * ratio)
  const dpsTarget = Math.sqrt(threatBudget / ratio)
  const scaleHp = hpTarget / natural
  const scaleDmg = opts?.naturalDps !== undefined && opts.naturalDps > 0 ? dpsTarget / opts.naturalDps : scaleHp
  const nWaves = Math.max(1, Math.floor(waves))
  const per = 1 / nWaves
  const slots = base.ships ?? []
  const ships: readonly FoeShipSlot[] | undefined =
    slots.length === 0
      ? base.ships
      : slots.flatMap((slot) =>
          Array.from({ length: nWaves }, (_, i) => ({
            ...slot,
            wave: i,
            hpMul: (slot.hpMul ?? 1) * scaleHp * per,
            dmgMul: (slot.dmgMul ?? 1) * scaleDmg * per,
            ...(slot.firepowerAnchor !== undefined
              ? { firepowerAnchor: Math.max(1, Math.round(slot.firepowerAnchor * scaleDmg * per)) }
              : {}),
          })),
        )
  /** 每波单位数（`waves[]` 只驱动"打几波"，编成由 `slot.wave` 决定；这里给出与实际一致的读数） */
  const perWaveUnits = (ships ?? []).length
    ? Array.from({ length: nWaves }, (_, i) =>
        (ships ?? [])
          .filter((s) => (s.wave ?? 0) === i)
          .reduce((n, s) => n + Math.max(1, Math.floor(s.count ?? 1)), 0),
      )
    : []
  return {
    ...base,
    name:
      kind === 'boss'
        ? `${base.name} · 第 ${depth} 层守卫`
        : kind === 'extract'
          ? // ⚠ 仅老档（撤离战 2026-09-15 退役）：敌名后缀避开已退役的机制名
            `${base.name} · 撤离`
          : `${base.name} · 第 ${depth} 层`,
    threat: target,
    ...(perWaveUnits.length > 0
      ? {
          ships,
          waves: perWaveUnits.map((units) => ({ units: Math.max(1, units), hpShare: 1 })),
        }
      : {}),
    // 层末 BOSS 专挑最大的船（船长 2026-09-13 的五模式里，「打最大的」落在 BOSS 上）；
    // **选靶按族限定**（船长 2026-09-15）：普通用途一律取**族定模式**（卡面字段只作展示/体检断言），
    // BOSS 仍走「打最大的」+ 概率化（船长 2026-09-14「挨个定为 60%」→ 同日改 40%）。
    foeTargeting: kind === 'boss' ? 'largest' : familyTargeting,
    foeTargetingChance:
      kind === 'boss'
        ? WORMHOLE_BOSS_TARGETING_CHANCE
        : familyTargeting === 'random'
          ? 1
          : WORMHOLE_FAMILY_TARGETING_CHANCE,
  }
}
