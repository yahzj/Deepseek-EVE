/**
 * **虫洞"敌情"文案**（船长 2026-09-16：「**扫描虫洞界面，给虫洞卡片添加更多信息
 * （虫洞内是什么敌人，以什么类型伤害为主）**」）。
 *
 * 显示口径（船长 2026-09-16 三问三答）：
 * - **卡片上一句话** = 族名 + 主系（取**族级 = 浅层卡**，`wormholeFamilyIntel` 的单点）；
 * - **悬停里列三档** = 浅/中/深各自的**卡名 + 火力构成**（⚠ 档间会变：D 族深层「能量 60% · 动能 40%」、
 *   E 族中层「纯高爆」）；
 * - **不给"建议抗性"**（船长明确不要）。
 *
 * 数据源一律走 core（`foeDamageComposition` ⇒ 与战斗结算、胜率预估同源）⇒ 卡面不会与实战脱节。
 * 扫描页卡片与进洞准备页**共用本模块**，两处口径不会漂。
 */
import { DAMAGE_TYPE_LABEL_IDS, WORMHOLE_FAMILY_ETHNIC_IDS } from '@whale/core'
import type { WormholeFamily } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'

/** 甲案（2026-09-20）：三档名/族称/伤害名都有 id（core 段 `core.wormholeFoes.*`）⇒ 悬停整句随语言变 */
const TIER_IDS: Readonly<Record<string, string>> = {
  shallow: 'core.wormholeFoes.001',
  mid: 'core.wormholeFoes.002',
  deep: 'core.wormholeFoes.003',
}

/** 一档的构成写法：「动能 80% · 高爆 20%」；单系 ⇒ 「纯高爆」 */
function partsText(parts: ReadonlyArray<{ type: 'kinetic' | 'explosive' | 'plasma'; share: number }>): string {
  const typeId = (t: 'kinetic' | 'explosive' | 'plasma'): string => tr(DAMAGE_TYPE_LABEL_IDS[t])
  if (parts.length <= 1) return tr('core.wormholeFoes.012', { p1: typeId(parts[0]?.type ?? 'kinetic') })
  return parts.map((p) => tr('core.wormholeFoes.013', { p1: typeId(p.type), p2: Math.round(p.share * 100) })).join(' · ')
}

/** 主系一句话（core 给结构化三元组，这里组当前语言的句子） */
function primaryTextOf(it: {
  primaryKind: 'pure' | 'main' | 'mixed'
  primaryTypeA: 'kinetic' | 'explosive' | 'plasma'
  primaryTypeB?: 'kinetic' | 'explosive' | 'plasma'
}): string {
  const a = tr(DAMAGE_TYPE_LABEL_IDS[it.primaryTypeA])
  if (it.primaryKind === 'pure') return tr('core.wormholeFoes.012', { p1: a })
  if (it.primaryKind === 'main') return tr('core.wormholeFoes.014', { p1: a })
  return tr('core.wormholeFoes.015', { p1: a, p2: tr(DAMAGE_TYPE_LABEL_IDS[it.primaryTypeB ?? 'kinetic']) })
}

/** 卡片上那一句：「**敌：劫掠支队（A 族 · 海盗）· 动能为主**」 */
export function wormholeIntelLine(engine: GameEngine, family: WormholeFamily): string {
  const it = engine.wormholeFamilyIntel(family)
  return tr('core.wormholeFoes.016', {
    p1: it.firstCardName,
    p2: it.family,
    p3: tr(WORMHOLE_FAMILY_ETHNIC_IDS[it.family]),
    p4: primaryTextOf(it),
  })
}

/**
 * 悬停完整口径（多行；`archName` 给了就补一句内容原型说明——扫描页卡片用得上）。
 * ⚠ 行尾不加句号堆叠，保持"读数条"那种紧凑感。
 */
export function wormholeIntelTip(engine: GameEngine, family: WormholeFamily, archName?: string): string {
  const it = engine.wormholeFamilyIntel(family)
  const lines = [
    tr('core.wormholeFoes.017', { p1: it.firstCardName, p2: it.family, p3: tr(WORMHOLE_FAMILY_ETHNIC_IDS[it.family]) }),
    tr('core.wormholeFoes.018'),
    ...it.tiers.map((t) =>
      tr('core.wormholeFoes.019', { p1: tr(TIER_IDS[t.tier] ?? t.tier), p2: t.cardName, p3: partsText(t.parts) }),
    ),
  ]
  if (archName) lines.push(tr('core.wormholeFoes.020', { p1: archName }))
  return lines.join('\n')
}
