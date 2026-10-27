/** 功能域职责拆分，保持原计算与顺序。 */
import type { WormholeFamily } from '../../state'
import type { WormholeFoeKind } from './curves'

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
export const WORMHOLE_CARD_FALLBACK = 'wh-pirate-scout'

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
export function mix32(x: number): number {
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
