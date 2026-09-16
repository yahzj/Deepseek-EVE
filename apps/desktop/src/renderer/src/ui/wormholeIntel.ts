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
import { DAMAGE_TYPE_LABELS, WORMHOLE_TIER_LABELS } from '@whale/core'
import type { WormholeFamily } from '@whale/core'
import type { GameEngine } from '../game/engine'

/** 一档的构成写法：「动能 80% · 高爆 20%」；单系 ⇒ 「纯高爆」 */
function partsText(parts: ReadonlyArray<{ type: 'kinetic' | 'explosive' | 'plasma'; share: number }>): string {
  if (parts.length <= 1) return `纯${DAMAGE_TYPE_LABELS[parts[0]?.type ?? 'kinetic']}`
  return parts.map((p) => `${DAMAGE_TYPE_LABELS[p.type]} ${Math.round(p.share * 100)}%`).join(' · ')
}

/** 卡片上那一句：「**敌：劫掠支队（A 族 · 海盗）· 动能为主**」 */
export function wormholeIntelLine(engine: GameEngine, family: WormholeFamily): string {
  const it = engine.wormholeFamilyIntel(family)
  return `敌：${it.firstCardName}（${it.family} 族 · ${it.ethnic}）· ${it.primaryText}`
}

/**
 * 悬停完整口径（多行；`archName` 给了就补一句内容原型说明——扫描页卡片用得上）。
 * ⚠ 行尾不加句号堆叠，保持"读数条"那种紧凑感。
 */
export function wormholeIntelTip(engine: GameEngine, family: WormholeFamily, archName?: string): string {
  const it = engine.wormholeFamilyIntel(family)
  const lines = [
    `敌：${it.firstCardName}（${it.family} 族 · ${it.ethnic}）——整趟都是这一族：敌人编成、稀有残骸、遗迹安全货柜与专属装备/图纸都出自这一族。`,
    '火力构成（会随层数变）：',
    ...it.tiers.map((t) => ` · ${WORMHOLE_TIER_LABELS[t.tier]} ${t.cardName}：${partsText(t.parts)}`),
  ]
  if (archName) {
    lines.push(`内容原型「${archName}」＝这一处的地点配比口味（威胁与产出随所在层数上升：越深越险、产出越高）。`)
  }
  return lines.join('\n')
}
