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
import { SHIP_HP_UPLIFT_MUL } from '../src/combatMath'
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
    let waveDps = 0
    for (const f of createFoeSpecs(card, bal, { units: w.units, hpShare: w.hpShare, tagPrefix: i === 0 ? '' : `w${i}-` })) {
      hp += f.hp.s + f.hp.a + f.hp.h
      for (const wep of f.weapons) waveDps += ((wep.shotDmg ?? 0) * (wep.count ?? 1) * 1000) / Math.max(1, wep.reloadMs)
    }
    dps = Math.max(dps, waveDps)
  })
  return Math.sqrt(hp * dps)
}

describe('敌卡威胁定价式（船长 2026-09-24「单舰 ×3 / 小队 ×10」）', () => {
  it('① 系数表：solo 3 · squad 10，且洞内常量与 squad 同源', () => {
    expect(FOE_DESIGN_STRENGTH_MUL).toEqual({ solo: 3, squad: 10 })
    expect(WORMHOLE_FOE_BASE_STRENGTH_MUL).toBe(FOE_DESIGN_STRENGTH_MUL.squad)
  })

  it('② 洞内一支（4 舰小队）：真实X含加血倍率，威胁标尺归一后不变', () => {
    const base = ctx.anomalies.get(WORMHOLE_FAMILY_CARDS.A.shallow!)!
    const card = wormholeDerivedAnomaly(ctx, base, { depth: 1, kind: 'node', waves: 1 })
    const x = xOf(card)
    expect(card.threat).toBe(45)
    // 实测X包含最终加血；取整边界按加血前标尺比较。
    expect(foeHpOfThreat(45, bal)).toBe(349)
    expect(x / Math.sqrt(SHIP_HP_UPLIFT_MUL)).toBeGreaterThan(690)
    expect(x / Math.sqrt(SHIP_HP_UPLIFT_MUL)).toBeLessThan(705)
    expect(foeThreatRatingOf(x, FOE_DESIGN_STRENGTH_MUL.squad, bal)).toBe(46)
  })

  it('③ 常驻悬赏卡面标签保持，取整后的实际威胁按峰值波反解最小整数', () => {
    const visible = ANOMALIES.filter((a) => a.hidden !== true && (a.ships ?? []).length > 0)
    expect(visible.length).toBe(23) // 常驻悬赏（洞外非隐藏）；隐藏模板 enc-* 不计
    const rated = visible.map((a) => ({ id: a.id, name: a.name, threat: a.threat, rating: foeThreatRatingOf(xOf(a), FOE_DESIGN_STRENGTH_MUL.solo, bal) }))
    const expected = [
      ['ano-training', 5, 10], ['ano-pirate-post', 17, 17], ['ano-abandoned-platform', 24, 24],
      ['ano-redring-raiders', 26, 27], ['ano-gravekeeper', 87, 87], ['ano-ghost-signal', 38, 38],
      ['ano-abyss-guard', 88, 72], ['ano-titan-wreck', 87, 88], ['ano-auro-raiders', 59, 59],
      ['ano-core-section', 115, 115], ['ano-starcore-boss', 73, 56], ['ano-cinder-siege', 64, 65],
      ['ano-echo-haunt', 51, 51], ['ano-nadir-static', 89, 89], ['ano-maw-hunt', 119, 109],
      ['ano-vault-sentinel', 110, 110], ['ano-voidedge-warden', 103, 103], ['ano-harbor-escort', 10, 12],
      ['ano-shard-bandits', 36, 29], ['ano-lantern-saboteurs', 30, 23], ['ano-haze-ambush', 34, 34],
      ['ano-mirage-hijackers', 68, 69], ['ano-chasm-aberrations', 84, 68],
    ]
    expect(rated.map(row => [row.id, row.threat, row.rating])).toEqual(expected)
    // 卡面标签沿已批准数据保持；逐层HP/单发向上取整后，反解另按实际预算检查最小整数。
    for (const row of rated) {
      const card = visible.find(card => card.id === row.id)!
      const need = 5 * xOf(card) / (FOE_DESIGN_STRENGTH_MUL.solo * Math.sqrt(SHIP_HP_UPLIFT_MUL))
      const expected = Array.from({ length: 1024 }, (_, i) => i + 1).find(t => foeHpOfThreat(t, bal) >= need)!
      expect(row.rating, row.id).toBe(expected)
      expect(foeHpOfThreat(row.rating, bal)).toBeGreaterThanOrEqual(need)
      if (row.rating > 1) expect(foeHpOfThreat(row.rating - 1, bal)).toBeLessThan(need)
    }
  })
})
