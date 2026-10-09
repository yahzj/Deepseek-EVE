import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { applyFoeOverride } from '../src/combat'
import { createFoeSpecs, foeStrengthOf, foeThreatOfAnomaly } from '../src/foeSpecs'
import { foeHpOfThreat } from '../src/foePower'
import { WRECK_GROUP_BY_KEY } from '../src/wreckGroups'
import type { AnomalyDef } from '../src/types'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const cases = [
  ['alien-vanguard', 90, 95, 1.19, 1.325],
  ['alien-escort', 108, 113, 1.49, 1.6289],
  ['alien-main', 129, 135, 1.02, 1.1085],
  ['alien-broodmother', 170, 179, 1.5, 1.739],
] as const
const currentThreats: Readonly<Record<string, number>> = {
  'alien-vanguard': 104, 'alien-escort': 123, 'alien-main': 150, 'alien-broodmother': 207,
}

function previousCard(card: AnomalyDef, threat: number, scale: number): AnomalyDef {
  const count = card.ships!.reduce((n, slot) => n + (slot.count ?? 1), 0)
  const comp = 2 * count / (count + 1)
  return {
    ...card,
    threat,
    ships: card.ships!.map(slot => ({
      ...slot,
      hpMul: slot.ship.id === 'foe-alien-broodmother' ? 20 : scale,
      dmgMul: scale / comp,
      ...(slot.firepowerAnchor !== undefined ? {
        firepowerAnchor: Math.round((slot.ship.id === 'foe-alien-hiveback' ? 228 : 558) * scale * (slot.count ?? 1)),
      } : {}),
    })),
  }
}

describe('C族入侵平均威胁提高5%', () => {
  it('四卡整数取整后的平均威胁提高约5%，回收体量不变', () => {
    const before = cases.reduce((n, [, value]) => n + value, 0) / cases.length
    // +5%批次预算保留；随后族格加血/炮伤调整单独重算显示威胁。
    const after = cases.reduce((n, [, , target]) => n + target, 0) / cases.length
    expect(before).toBe(124.25)
    expect(after).toBe(130.5)
    expect(after / before).toBeCloseTo(1.05, 3)
    expect(WRECK_GROUP_BY_KEY.get('c-inv')!.threat).toBe(124)
  })

  it.each(cases)('%s的新标签与真实预算一致，不只修改显示数字', (id, oldThreat, target, oldScale, scale) => {
    const card = ctx.anomalies.get(id)!
    const old = previousCard(card, oldThreat, oldScale)
    const design = id === 'alien-broodmother' ? 10 : 3
    expect(target).toBe(Math.round(oldThreat * 1.05))
    expect(card.threat).toBe(currentThreats[id])
    expect(foeThreatOfAnomaly(card, design, bal)).toBe(card.threat)
    expect(foeThreatOfAnomaly(old, design, bal)).toBeLessThan(card.threat)
    const budget = 5 * foeStrengthOf(card, bal).x / design
    expect(budget).toBeLessThanOrEqual(foeHpOfThreat(card.threat, bal))
    expect(budget).toBeGreaterThan(foeHpOfThreat(card.threat - 1, bal))
    expect(card.wreckThreat).toBe(oldThreat)
    expect(card.threatJudged).toBe(oldThreat)
    for (const slot of card.ships!) {
      expect(slot.hpMul).toBe(slot.ship.id === 'foe-alien-broodmother' ? 20 : scale)
    }
  })

  it.each(cases)('%s增加卡内血量和输出，编成、射程和挂载机制不变', (id, oldThreat, _target, oldScale) => {
    const card = ctx.anomalies.get(id)!
    const old = previousCard(card, oldThreat, oldScale)
    for (let wave = 0; wave < card.waves!.length; wave++) {
      const options = { tagPrefix: wave === 0 ? '' : `w${wave}-` }
      const before = createFoeSpecs(old, bal, options)
      const after = createFoeSpecs(card, bal, options)
      expect(after).toHaveLength(before.length)
      for (let index = 0; index < after.length; index++) {
        const from = before[index]!
        const to = after[index]!
        expect(to.foeShipId).toBe(from.foeShipId)
        for (const layer of ['s', 'a', 'h'] as const) {
          if (to.foeShipId === 'foe-alien-broodmother') expect(to.hp[layer]).toBe(from.hp[layer])
          else expect(to.hp[layer]).toBeGreaterThan(from.hp[layer])
        }
        expect(to.evasion).toBe(from.evasion)
        expect(to.resists).toEqual(from.resists)
        expect(to.speedMps).toBe(from.speedMps)
        expect(to.foeHatchery).toEqual(from.foeHatchery)
        expect(to.foeChargeMul).toBe(from.foeChargeMul)
        expect(to.weapons.map(w => [w.gunCount, w.hitRate, w.maxRangeM, w.reloadMs])).toEqual(
          from.weapons.map(w => [w.gunCount, w.hitRate, w.maxRangeM, w.reloadMs]),
        )
        if (to.acidBurst) expect(to.acidBurst.damage).toBeGreaterThan(from.acidBurst!.damage!)
        else expect(to.weapons.reduce((n, w) => n + (w.shotDmg ?? 0), 0)).toBeGreaterThan(
          from.weapons.reduce((n, w) => n + (w.shotDmg ?? 0), 0),
        )
      }
    }
  })

  it.each([
    [150000, { s: 30000, a: 82500, h: 37500 }],
    [1000, { s: 0, a: 0, h: 1000 }],
  ] as const)('巢母%s共享池绝对覆写不被新卡倍率扩大', (bossHp, layers) => {
    const card = ctx.anomalies.get('alien-broodmother')!
    const override = {
      bossShipId: 'foe-alien-broodmother', bossHp, bossHpMax: 150000,
      bossHpLayers: layers, bossMaxLayers: { s: 30000, a: 82500, h: 37500 },
    }
    const built = applyFoeOverride(card, override)
    const mother = createFoeSpecs(built, bal, { tagPrefix: 'w3-' }).find(unit => unit.foeShipId === override.bossShipId)!
    for (const layer of ['s', 'a', 'h'] as const) expect(mother.hp[layer]).toBeCloseTo(layers[layer], 8)
  })

  it('其他两族入侵威胁保持原值', () => {
    for (const [id, threat] of [
      ['ink-harass', 90], ['ink-raid', 108], ['ink-main', 132], ['ink-flagship', 170],
      ['corona-drift', 90], ['corona-split', 108], ['corona-converge', 129], ['corona-nexus', 170],
    ] as const) expect(ctx.anomalies.get(id)!.threat).toBe(threat)
  })
})
