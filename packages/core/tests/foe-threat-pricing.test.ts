/**
 * **敌卡威胁的定价式（船长 2026-09-25 裁定）** —— 「**单舰 ×3 · 4 舰小队 ×10**」写进规则。
 *
 * 船长原话（照抄）：
 * 1.「那么就针对单舰作战还是4艘小队作战的敌卡进行 `WORMHOLE_FOE_BASE_STRENGTH_MUL` 的不同，
 *    **小队作战的依旧是 ×10，单人的按照 ×3 算**」；
 * 2.「虫洞不是按照"我方参战舰数"分流，而是**这张卡设计是给小队打的**，不考虑玩家实际参战舰船数量」；
 * 3.「常驻悬赏都是**预设（并且规则上也写死了）给单舰打的**」。
 *
 * 定价式（与引擎同源，2026-09-25 逐层/逐卡实测核对）：
 * ```
 * X = √(全波总血 × 全波总火力DPS) = 2 × foeHpOfThreat(威胁) ÷ 10 × 系数
 * ⇒ 威胁 = foeHpOfThreat⁻¹( 5X ÷ 系数 )        ← `combat.foeThreatRatingOf`
 * ```
 * 洞内那一支由派生链天然满足（`hpBudget = F(威胁) × 10` → `budget² / 25` → 开方 ⇒ `X = 2F(威胁)`）。
 *
 * 本文件钉三件事：
 * ① **系数表**：`FOE_DESIGN_STRENGTH_MUL = { solo: 3, squad: 10 }`，且洞内常量与 `squad` 同源；
 * ② **洞内一支自检**：真派生卡的 `X` 恰为 `2 × F(引擎威胁)`（层 1 = 697 ≈ 2×349）；
 * ③ **洞外一支 = 全部常驻悬赏卡**：每张非隐藏卡的 `threat` 必须等于按 `solo` 反解出的值
 *    （= 2026-09-25 重定标批的验收口径；**隐藏遭遇模板 `enc-*` 不走这条**，它们不是常驻悬赏）。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES, buildSimContext } from '@whale/data'
import type { AnomalyDef } from '../src/types'
import { createFoeSpecs, foeHpOfThreat, foeThreatRatingOf, wormholeDerivedAnomaly } from '../src/combat'
import {
  FOE_DESIGN_STRENGTH_MUL,
  WORMHOLE_FOE_BASE_STRENGTH_MUL,
  WORMHOLE_FAMILY_CARDS,
} from '../src/wormholeFoes'

const ctx = buildSimContext()
const bal = ctx.balance.battle

/** 一张卡（未派生）的 `X = √(全波总血 × 全波总火力DPS)` —— 与体检/探针同一口径（逐波建档后加总） */
function xOf(card: AnomalyDef): number {
  let hp = 0
  let dps = 0
  const waves = card.waves && card.waves.length > 0 ? card.waves : [{ units: 1, hpShare: 1 }]
  waves.forEach((w, i) => {
    for (const f of createFoeSpecs(card, bal, { units: w.units, hpShare: w.hpShare, tagPrefix: i === 0 ? '' : `w${i}-` })) {
      hp += f.hp.s + f.hp.a + f.hp.h
      for (const wep of f.weapons) dps += ((wep.shotDmg ?? 0) * (wep.count ?? 1) * 1000) / Math.max(1, wep.reloadMs)
    }
  })
  return Math.sqrt(hp * dps)
}

describe('敌卡威胁定价式（船长 2026-09-24「单舰 ×3 / 小队 ×10」）', () => {
  it('① 系数表：solo 3 · squad 10，且洞内常量与 squad 同源', () => {
    expect(FOE_DESIGN_STRENGTH_MUL).toEqual({ solo: 3, squad: 10 })
    expect(WORMHOLE_FOE_BASE_STRENGTH_MUL).toBe(FOE_DESIGN_STRENGTH_MUL.squad)
  })

  it('② 洞内一支（4 舰小队）：真派生卡 X = 2 × F(引擎威胁)', () => {
    const base = ctx.anomalies.get(WORMHOLE_FAMILY_CARDS.A.shallow!)!
    const card = wormholeDerivedAnomaly(ctx, base, { depth: 1, kind: 'node', waves: 1 })
    const x = xOf(card)
    expect(card.threat).toBe(45)
    // F(45) = 12.8 × (5 + 85×((45−6)/90)^1.6) = 349 ⇒ X 应为 698（取整与逐条分摊带来 ±1）
    expect(foeHpOfThreat(45, bal)).toBe(349)
    expect(x).toBeGreaterThan(690)
    expect(x).toBeLessThan(705)
    expect(foeThreatRatingOf(x, FOE_DESIGN_STRENGTH_MUL.squad, bal)).toBe(45)
  })

  it('③ 洞外一支（单舰）= 全部常驻悬赏卡：威胁必须等于按 solo 反解的值', () => {
    const visible = ANOMALIES.filter((a) => a.hidden !== true && (a.ships ?? []).length > 0)
    expect(visible.length).toBe(23) // 常驻悬赏（洞外非隐藏）；隐藏模板 enc-* 不计
    const rated = visible.map((a) => ({ id: a.id, name: a.name, threat: a.threat, rating: foeThreatRatingOf(xOf(a), FOE_DESIGN_STRENGTH_MUL.solo, bal) }))
    /**
     * ⚠ **低端平带例外**（2026-09-25 手动重定价批）：威胁 1~6 的曲线值**恒为 11**（`max(6,T)` 地板）
     * ⇒ 反解永远返回平带起点（"威胁 5"的价 = "威胁 1"的价 ⇒ 反解给 1）。故判据取**同价带**：
     * `F(反解) === F(卡面)` 视为一致；其余必须**逐字相等**，且例外只允许出现在 `threat ≤ 6`。
     */
    const bad = rated.filter((r) => r.rating !== r.threat && foeHpOfThreat(r.rating, bal) !== foeHpOfThreat(r.threat, bal))
    expect(
      bad.map((r) => `${r.name}：卡面 ${r.threat}，按属性反解 ${r.rating}`),
      '这些卡的 threat 与属性不满足「单舰 ×3」定价式（改属性必须同步改威胁，或反之）',
    ).toEqual([])
    const exceptions = rated.filter((r) => r.rating !== r.threat)
    expect(exceptions.every((r) => r.threat <= 6), '平带例外只允许出现在威胁 ≤ 6 这一段').toBe(true)
  })
})
