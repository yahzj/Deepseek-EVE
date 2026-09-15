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
import type { AnomalyDef, FoeShipSlot, FoeTargetingMode } from './types'
import type { WormholeFamily } from './state'

/* ═══════════ 一、层曲线（威胁 / 收益） ═══════════ */

/** 第 1 层基准威胁 */
export const WORMHOLE_THREAT_BASE = 45
/** 每层**威胁**增幅（等比 ×1.16 ⇒ 层 1~3 = 45/52/61，与设计稿"≈45~60"同量级） */
export const WORMHOLE_THREAT_GROWTH = 0.16
/** 每层**收益**增幅（等比 ×1.2）。**必须大于威胁增幅** —— 船长 2026-09-13：
 *  「深层收益应该比难度曲线要更高」⇒ 用等比而非加法，才能让"单位威胁收益"**逐层严格上升**
 *  （若威胁用 +9 加法，层 1→2 的威胁增幅恰好 20%、与收益打平，头两层看不出"更赚"）。 */
export const WORMHOLE_REWARD_GROWTH = 0.2
/** 兼容取整：每层威胁的**名义**增量（= 45×0.16 ≈ 7，落在设计稿"+8~10"附近，供文档/读数引用） */
export const WORMHOLE_THREAT_PER_LAYER = Math.round(WORMHOLE_THREAT_BASE * WORMHOLE_THREAT_GROWTH)

/** 第 `depth` 层的威胁（层 1 = 45，每层 ×1.16，取整） */
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

/** 洞内敌卡的用途：普通节点 / 层末 BOSS / 撤离战 / **遗迹收尾战**（威胁倍率与选靶模式按此分流） */
export type WormholeFoeKind = 'node' | 'boss' | 'extract' | 'ruins'

/** 层末 **BOSS** 的威胁倍率（设计稿 §3 表：本层 ×1.2） */
export const WORMHOLE_BOSS_THREAT_MUL = 1.2
/** **撤离战**的威胁倍率（设计稿 §3 表：当层威胁 ×0.8）——**只用于层 2 的基准**，见下 */
export const WORMHOLE_EXTRACT_THREAT_MUL = 0.8

/**
 * **撤离战威胁 = 线性**（船长 2026-09-13 裁定：「**撤离威胁按线性**」，回应"线性还是等比"那一问）。
 *
 * 口径：**层 2 = 42**（= 层 2 威胁 52 × 0.8，与改判前的层 2 读数一致），之后**每层 +7**
 * （7 = 层增量的名义值 `WORMHOLE_THREAT_PER_LAYER`）——即"与前进的层数成正比"。
 * 层 1 没有拦截舰队（`WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH = 2`），本函数对层 1 也按层 2 取值，
 * 免得别处误用出负数。
 *
 * 为什么不像节点战那样等比（×1.16/层）：撤离战是"拿了就跑"的拦截，等比到深处会指数翻上去
 * （层 8 等比 102 / 线性 84、层 12 等比 158 / 线性 112）——**节点战照旧等比**（那才是"越深越硬"），
 * 只有撤离这一路改成线性。
 */
export const WORMHOLE_EXTRACT_THREAT_BASE = Math.round(
  WORMHOLE_THREAT_BASE * (1 + WORMHOLE_THREAT_GROWTH) * WORMHOLE_EXTRACT_THREAT_MUL, // 层 2 = 52 × 0.8 = 42
)
/** 撤离战**每层增量**（线性；= 层增量名义值 7） */
export const WORMHOLE_EXTRACT_THREAT_PER_LAYER = WORMHOLE_THREAT_PER_LAYER

/** 第 `depth` 层**撤离战**的威胁（线性：层 2 = 42、层 3 = 49、层 4 = 56……层 8 = 84） */
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

/** 某张敌卡的**自然总血**（按编成条目的舰级绝对值 × 条数，不含派生缩放） */
export function wormholeNaturalHp(base: AnomalyDef): number {
  return (base.ships ?? []).reduce(
    (n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
    0,
  )
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
  // —— 中层 / 深层（2026-09-15 起逐批补：批 1 = A 族 · 批 2 = C 族 · 批 3 = D 族） ——
  'wh-pirate-hunt',
  'wh-pirate-warband',
  'wh-alien-brood',
  'wh-alien-hive',
  'wh-grave-sentry',
  'wh-grave-throne',
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
 * **分层血量修正**（船长 2026-09-15：「中层配置血量*1.1.深层配置血量*1.2」）。
 *
 * 只乘**血量缩放**、不乘火力缩放（见 `wormholeAnomalyOf` 的 `scaleHp` / `scaleDmg` 拆分）
 * ⇒ 表现 = "更耐打、但不更疼"；由此"同层同族不同卡总血恒等"改为**"同层同档位总血恒等"**。
 */
export const WORMHOLE_TIER_HP_MUL: Readonly<Record<WormholeCardTier, number>> = {
  shallow: 1,
  mid: 1.1,
  deep: 1.2,
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
  E: { shallow: 'wh-titan-echo', mid: null, deep: null },
  G: { shallow: 'wh-exile-blockade', mid: null, deep: null },
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
 */
export function wormholeFamilyOfSeed(seed: number): WormholeFamily {
  const s = Math.abs(Math.floor(seed)) % 1_000_000_007
  const h = Math.abs((s * 1103515245 + 12345) % WORMHOLE_FAMILY_ORDER.length)
  return WORMHOLE_FAMILY_ORDER[h]!
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
 * - 威胁：`wormholeFoeThreat(depth, kind)`；
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
   * - `hpBudget`：**本场敌卡的期望总血**（由引擎按威胁曲线 × `WORMHOLE_FOE_BASE_STRENGTH_MUL` 算好传进来；
   *   不给 = 用本卡的"自然总血" ⇒ 只做威胁字段的换算，不缩放条目）。
   * - `strengthMul`：**校准用覆写**（只有 `tools/wormhole-econ.ts` 会传；引擎/实战一律走常量）。
   * - `hpScaleMul`：**分层血量修正**（浅 1 / 中 1.1 / 深 1.2，见 `WORMHOLE_TIER_HP_MUL`）——
   *   **只乘血、不乘火力** ⇒ "更耐打但不更疼"；缺省 1 = 与旧口径逐字一致。
   */
  opts?: { hpBudget?: number; strengthMul?: number; hpScaleMul?: number },
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
  const target = wormholeFoeThreat(depth, kind)
  const natural = Math.max(1, wormholeNaturalHp(base))
  const budget = (opts?.hpBudget ?? natural) * (opts?.strengthMul ?? 1)
  // **按卡归一**：把每张卡的总血**压到同一个预算**上（各卡的"坦克/脆皮"性格由原编成的血比保留），
  // 同时**同比例**缩放火力 ⇒ 卡间强度不再悬殊（"威胁 = 战力标尺"由构造保证）。
  // 2026-09-15：血量与火力**拆成两个系数**——血再乘一道**分层修正**（浅/中/深），火力只吃血预算。
  const scaleDmg = budget / natural
  const scaleHp = scaleDmg * (opts?.hpScaleMul ?? 1)
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
          ? `${base.name} · 撤离战`
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
