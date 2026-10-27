/** 功能域职责拆分，保持原计算与顺序。 */
import type { DamageType, SimContext } from '../../types'
import type { WormholeFamily } from '../../state'
import { type WormholeCardTier, WORMHOLE_CARD_TIERS, WORMHOLE_FAMILY_CARDS, WORMHOLE_CARD_FALLBACK, WORMHOLE_FAMILY_ETHNIC, WORMHOLE_FAMILY_CARD, wormholeFamilyOfSeed } from './pool'
import { foeDamageComposition } from '../../combat/composition'

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
