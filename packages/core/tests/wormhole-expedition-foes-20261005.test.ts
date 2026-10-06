import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_G_REMNANT_TENDER } from '@whale/data'
import type { AnomalyDef, BattleBalance } from '../src/types'
import type { WormholeFamily } from '../src/state'
import type { UnitSpec } from '../src/combat'
import { pdEnabledFor, pulseFoeRepair } from '../src/combat'
import { createInitialState } from '../src/state'
import { createBattleState, createFoeSpecs, resolveReinforcements } from '../src/foeSpecs'
import { foeHpOfThreat, foeThreatRatingOf } from '../src/foePower'
import { FOE_MOUNT_IDS, FOE_MOUNTS } from '../src/foeMounts'
import { WORMHOLE_FAMILY_CARDS, WORMHOLE_FAMILY_TARGETING, wormholeSkippedBranch } from '../src/wormholeFoes'
import {
  wormholeExpeditionCard,
  wormholeExpeditionFoeSpecs,
  wormholeExpeditionModifyCard,
  wormholeExpeditionStrengthOf,
} from '../src/wormholeExpeditionFoes'
import type {
  WormholeExpeditionFoeContext,
  WormholeExpeditionFoeRole,
  WormholeExpeditionFoeSpec,
} from '../src/wormholeExpeditionFoes'

const ctx: WormholeExpeditionFoeContext = {
  ...buildSimContext(),
  foeShips: new Map([[FOE_G_REMNANT_TENDER.id, FOE_G_REMNANT_TENDER]]),
}
const bal = ctx.balance.battle
const families: WormholeFamily[] = ['A', 'C', 'D', 'E', 'G']
const roles: WormholeExpeditionFoeRole[] = ['ordinary', 'elite', 'guard', 'patrol', 'event']

const roleScale: Readonly<Record<WormholeExpeditionFoeRole, number>> = {
  ordinary: 1, elite: 1.2, guard: 1.15, patrol: 1, event: 1,
}

function dpsOf(specs: readonly UnitSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.weapons.reduce((n, weapon) => weapon.reserve === true
    ? n
    : n + (weapon.shotDmg ?? 0) * (weapon.count ?? 1) * 1000 / Math.max(1, weapon.reloadMs), 0), 0)
}

function hpOf(specs: readonly UnitSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.hp.s + spec.hp.a + spec.hp.h, 0)
}

function freezeDeep(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freezeDeep(child)
  Object.freeze(value)
}

function active(card: AnomalyDef, balance: BattleBalance = bal): UnitSpec[] {
  const skip = wormholeSkippedBranch(card)
  return createFoeSpecs(card, balance).filter((spec) => skip === null || spec.foeReinforceBranch !== skip)
}

describe('新趟敌卡单点：确定性、共享表及同族', () => {
  it('冻住全部卡/舰级/平衡表仍可生成；返回副本可以独立修改', () => {
    const frozen: WormholeExpeditionFoeContext = {
      ...ctx,
      anomalies: structuredClone(ctx.anomalies),
      foeShips: structuredClone(ctx.foeShips),
      balance: structuredClone(ctx.balance),
    }
    for (const card of frozen.anomalies.values()) freezeDeep(card)
    for (const ship of frozen.foeShips!.values()) freezeDeep(ship)
    freezeDeep(frozen.balance)
    const before = structuredClone([...frozen.anomalies.entries()])
    for (const family of families) {
      for (const role of roles) {
        const first = wormholeExpeditionCard(frozen, family, 10, role)
        expect(wormholeExpeditionCard(frozen, family, 10, role)).toEqual(first)
        expect(first.hidden).toBe(true)
        expect(first.region).toBe('wh')
        expect(first.rewardIsk).toBe(0)
        expect(first.loot).toEqual([])
        expect(first.foeFamily).toBe(family)
        expect(first.ships!.every((slot) => slot.ship.family === family)).toBe(true)
        expect(first.foeTargeting).toBe(role === 'guard' ? 'largest' : WORMHOLE_FAMILY_TARGETING[family])
        expect(first.foeTargetingChance).toBe(first.foeTargeting === 'random' ? 1 : 0.4)
        first.ships![0]!.ship.hp = 1
        first.ships![0]!.ship.split.h = 1
        expect(wormholeExpeditionCard(frozen, family, 10, role).ships![0]!.ship.hp).not.toBe(1)
      }
    }
    expect([...frozen.anomalies.entries()]).toEqual(before)
    expect(frozen.foeShips!.get(FOE_G_REMNANT_TENDER.id)).toEqual(FOE_G_REMNANT_TENDER)
  })

  it('保存spec再派生，不注册临时ctx卡；event复用普通预算', () => {
    const before = [...ctx.anomalies.keys()]
    const spec: WormholeExpeditionFoeSpec = {
      family: 'D', depth: 7, expeditionRules: 2, expeditionRole: 'event', guardSupportDisabled: false,
    }
    const restored = JSON.parse(JSON.stringify(spec)) as WormholeExpeditionFoeSpec
    const card = wormholeExpeditionCard(ctx, restored.family, restored.depth, restored.expeditionRole, restored.guardSupportDisabled)
    expect(card.expeditionFoe.strength).toEqual(wormholeExpeditionCard(ctx, 'D', 7, 'ordinary').expeditionFoe.strength)
    expect([...ctx.anomalies.keys()]).toEqual(before)
  })

  it('缺少G后勤定义明确报错，可从ctx.foeShips或已注入的卡取既有定义', () => {
    const without: WormholeExpeditionFoeContext = { ...buildSimContext(), foeShips: undefined }
    expect(() => wormholeExpeditionCard(without, 'G', 7, 'elite'))
      .toThrow('wormhole-expedition-foe-ship-missing:foe-g-remnant-tender')
    expect(() => wormholeExpeditionCard(without, 'G', 7, 'ordinary')).not.toThrow()
    const base = without.anomalies.get(WORMHOLE_FAMILY_CARDS.G.deep!)!
    const injected: AnomalyDef = { ...base, id: 'test-tender-definition', ships: [{ ship: FOE_G_REMNANT_TENDER }] }
    const throughCard = { ...without, anomalies: new Map([...without.anomalies, [injected.id, injected]]) }
    expect(wormholeExpeditionCard(throughCard, 'G', 7, 'elite')).toEqual(wormholeExpeditionCard(ctx, 'G', 7, 'elite'))
  })

  it('层数归一化、非法输入不静默跨族兜底', () => {
    expect(wormholeExpeditionCard(ctx, 'A', 0, 'ordinary')).toEqual(wormholeExpeditionCard(ctx, 'A', 1, 'ordinary'))
    expect(wormholeExpeditionCard(ctx, 'A', 3.9, 'ordinary')).toEqual(wormholeExpeditionCard(ctx, 'A', 3, 'ordinary'))
    expect(() => wormholeExpeditionCard(ctx, 'A', Number.NaN, 'ordinary')).toThrow('spec-invalid')
    expect(() => wormholeExpeditionCard(ctx, 'A', Infinity, 'ordinary')).toThrow('spec-invalid')
    expect(() => wormholeExpeditionCard(ctx, 'H' as WormholeFamily, 4, 'ordinary')).toThrow('spec-invalid')
  })
})

describe('新趟HP/DPS：首层现行预算与线性总量', () => {
  for (const family of families) {
    it(`${family}族普通不换重机制；五种用途HP/DPS共用首层浅卡自然比`, () => {
      const first = wormholeExpeditionCard(ctx, family, 1, 'ordinary')
      const baseline = foeHpOfThreat(45, bal) * 10
      expect(first.expeditionFoe.budget.x).toBeCloseTo(baseline / 5, 8)
      const shape = first.ships!.map((slot) => ({ id: slot.ship.id, count: slot.count, mounts: slot.mounts, drones: slot.ship.drones }))
      for (const depth of [1, 2, 3, 4, 7, 10, 30, 100]) {
        const ordinary = wormholeExpeditionCard(ctx, family, depth, 'ordinary')
        expect(ordinary.ships!.map((slot) => ({ id: slot.ship.id, count: slot.count, mounts: slot.mounts, drones: slot.ship.drones }))).toEqual(shape)
        for (const role of roles) {
          const card = wormholeExpeditionCard(ctx, family, depth, role)
          const plan = card.expeditionFoe
          const scale = (1 + 0.04 * (depth - 1)) * roleScale[role]
          const real = wormholeExpeditionStrengthOf(card, bal)
          expect(plan.scale).toBeCloseTo(scale, 10)
          expect(plan.budget.hp / first.expeditionFoe.budget.hp).toBeCloseTo(scale, 10)
          expect(plan.budget.dps / first.expeditionFoe.budget.dps).toBeCloseTo(scale, 10)
          expect(real.hp / plan.budget.hp).toBeCloseTo(1, 8)
          // 依据现有逐舰/逐架单发整数化，取最近的不超额档。
          expect(real.dps).toBeLessThanOrEqual(plan.budget.dps + 1e-8)
          expect(real.dps / plan.budget.dps).toBeGreaterThan(0.99)
          expect(plan.strength).toEqual(real)
          expect(card.threat).toBe(foeThreatRatingOf(real.x, 10, bal))
          expect(card.threatJudged).toBe(plan.pointDefense.threatJudged)
          expect(card.wormholeRepairScale).toBe(plan.repairScale)
          expect(card.wormholePdTags).toEqual(plan.pointDefense.unitTags)
          expect(card.ships!.every((slot) => Number.isFinite(slot.hpMul) && Number.isFinite(slot.dmgMul))).toBe(true)
        }
      }
      expect(wormholeExpeditionCard(ctx, family, 10, 'patrol').expeditionFoe.strength)
        .toEqual(wormholeExpeditionCard(ctx, family, 10, 'ordinary').expeditionFoe.strength)
    })
  }

  it('E备用库存不被当作额外常驻火力，建档仍保留有限库存和既有增程', () => {
    const card = wormholeExpeditionCard(ctx, 'E', 7, 'elite')
    const specs = wormholeExpeditionFoeSpecs(card, bal)
    expect(specs[0]!.foeDroneReserve).toEqual({ count: 7, respawnMs: 10_000 })
    expect(specs[0]!.foeDroneRangeMulOnHit).toBe(4)
    expect(specs[0]!.speedMps).toBe(0)
    expect(specs[0]!.weapons.filter((weapon) => weapon.reserve === true)).toHaveLength(7)
    expect(dpsOf(specs)).toBeCloseTo(card.expeditionFoe.strength.dps, 10)
  })
})

describe('五族代表机制及解除支援', () => {
  it('A只有头目和一艘网支援，解除网不改变属性与其他挂件', () => {
    const full = wormholeExpeditionCard(ctx, 'A', 7, 'elite')
    const off = wormholeExpeditionCard(ctx, 'A', 7, 'elite', true)
    const fullSpecs = wormholeExpeditionFoeSpecs(full, bal)
    const offSpecs = wormholeExpeditionFoeSpecs(off, bal)
    expect(fullSpecs).toHaveLength(2)
    expect(fullSpecs.filter((spec) => spec.foeCaptureWeb)).toHaveLength(1)
    expect(offSpecs.every((spec) => !spec.foeCaptureWeb)).toBe(true)
    expect(off.expeditionFoe.strength).toEqual(full.expeditionFoe.strength)
    expect(offSpecs.every((spec) => spec.foeChargeMul === 1.6 && spec.foeEvasionBonusAdd === 0.1)).toBe(true)
  })

  it('C孢群载体配成虫，有限机群；普通没有孢群/噬口跳档', () => {
    const specs = wormholeExpeditionFoeSpecs(wormholeExpeditionCard(ctx, 'C', 3, 'elite'), bal)
    expect(specs.filter((spec) => spec.foeShipId === 'foe-alien-spore-hive')).toHaveLength(1)
    expect(specs.filter((spec) => spec.foeShipId === 'foe-alien-starcore-adult')).toHaveLength(2)
    expect(specs.flatMap((spec) => spec.weapons).filter((weapon) => weapon.src === 'drone')).toHaveLength(3)
    expect(specs.every((spec) => !spec.foeDroneReserve)).toBe(true)
    expect(wormholeExpeditionCard(ctx, 'C', 10, 'elite', true).expeditionFoe.strength)
      .toEqual(wormholeExpeditionCard(ctx, 'C', 10, 'elite').expeditionFoe.strength)
  })

  it('D两支互斥援军血/火力同份额，总预算只记一支；关闭支援不回填主力', () => {
    const full = wormholeExpeditionCard(ctx, 'D', 7, 'guard')
    const off = wormholeExpeditionCard(ctx, 'D', 7, 'guard', true)
    const specs = wormholeExpeditionFoeSpecs(full, bal)
    const main = specs.filter((spec) => spec.foeReinforceBranch === undefined)
    const inside = specs.filter((spec) => spec.foeReinforceBranch === 'inside')
    const outside = specs.filter((spec) => spec.foeReinforceBranch === 'outside')
    expect(main).toHaveLength(1)
    expect(inside).toHaveLength(2)
    expect(outside).toHaveLength(2)
    expect(inside.concat(outside).every((spec) => spec.foeReinforceAt?.sec === 20)).toBe(true)
    expect(main[0]!.foeSupportCall?.delaySec).toBe(20)
    expect(hpOf(inside)).toBeCloseTo(hpOf(outside), 8)
    expect(Math.abs(dpsOf(inside) - dpsOf(outside))).toBeLessThan(0.6)
    expect(hpOf(main.concat(inside))).toBeCloseTo(full.expeditionFoe.budget.hp, 8)
    expect(hpOf(inside) / full.expeditionFoe.strength.hp).toBeGreaterThan(0.30)
    expect(hpOf(inside) / full.expeditionFoe.strength.hp).toBeLessThan(0.34)
    expect(dpsOf(inside) / full.expeditionFoe.strength.dps).toBeGreaterThan(0.25)
    expect(dpsOf(inside) / full.expeditionFoe.strength.dps).toBeLessThan(0.31)
    const surviving = wormholeExpeditionFoeSpecs(off, bal)
    expect(surviving).toHaveLength(1)
    expect(surviving[0]!.hp).toEqual(main[0]!.hp)
    expect(surviving[0]!.weapons).toEqual(main[0]!.weapons)
    expect(surviving[0]!.foeSupportCall).toBeUndefined()
    expect(off.threat).toBeLessThan(full.threat)
    expect(off.expeditionFoe.strength.hp).toBeLessThan(full.expeditionFoe.strength.hp)
    expect(off.expeditionFoe.strength.dps).toBeLessThan(full.expeditionFoe.strength.dps)
  })

  for (const distance of [1, 100_000]) {
    it(`D真实支援判定：距离${distance}，20秒只到场两艘并锁存`, () => {
      const card = wormholeExpeditionCard(ctx, 'D', 7, 'elite')
      const foes = wormholeExpeditionFoeSpecs(card, bal)
      const player: UnitSpec = { ...foes[0]!, tag: 'player', side: 'me', weapons: [] }
      const battle = createBattleState(player, foes, 0, 1000)
      const state = createInitialState({ nowWallMs: 0, seed: 71 })
      battle.distanceM = distance
      battle.lastTickGameMs = 19_999
      state.gameMs = battle.lastTickGameMs
      resolveReinforcements(state, ctx, battle, card, foes, bal, distance)
      expect(Object.values(battle.units).filter((unit) => unit.side === 'foe')).toHaveLength(1)
      battle.lastTickGameMs = 20_000
      state.gameMs = battle.lastTickGameMs
      resolveReinforcements(state, ctx, battle, card, foes, bal, distance)
      const expected = distance === 1 ? 'foe-d-ghost' : 'foe-d-stasis'
      expect(Object.values(battle.units).filter((unit) => unit.foeShipId === expected)).toHaveLength(2)
      battle.distanceM = distance === 1 ? 100_000 : 1
      battle.lastTickGameMs = 60_000
      state.gameMs = battle.lastTickGameMs
      resolveReinforcements(state, ctx, battle, card, foes, bal, distance)
      expect(Object.values(battle.units).filter((unit) => unit.side === 'foe')).toHaveLength(3)
    })
  }

  it('E真实去掉备用机库，保持出击机群、增程和幸存主力预算', () => {
    const full = wormholeExpeditionCard(ctx, 'E', 7, 'guard')
    const off = wormholeExpeditionCard(ctx, 'E', 7, 'guard', true)
    const specs = wormholeExpeditionFoeSpecs(off, bal)
    expect(specs[0]!.foeDroneReserve).toBeUndefined()
    expect(specs[0]!.weapons.some((weapon) => weapon.reserve === true)).toBe(false)
    expect(specs[0]!.weapons.filter((weapon) => weapon.src === 'drone')).toHaveLength(7)
    expect(specs[0]!.foeDroneRangeMulOnHit).toBe(4)
    expect(off.expeditionFoe.strength).toEqual(full.expeditionFoe.strength)
  })

  it('G后勤排在自动选靶前端、无自修/机群；去后勤不回填血/火力', () => {
    const full = wormholeExpeditionCard(ctx, 'G', 7, 'elite')
    const off = wormholeExpeditionCard(ctx, 'G', 7, 'elite', true)
    const specs = wormholeExpeditionFoeSpecs(full, bal)
    expect(specs).toHaveLength(2)
    expect(specs[0]!.foeShipId).toBe(FOE_G_REMNANT_TENDER.id)
    expect(specs[0]!.repairPct).toBe(0.5)
    expect(specs[0]!.foeRepairPulse).toBeUndefined()
    expect(specs.every((spec) => !spec.foeDrones)).toBe(true)
    expect(specs[1]!.foeShipId).toBe('foe-g-exile-battleship')
    const surviving = wormholeExpeditionFoeSpecs(off, bal)
    expect(surviving).toHaveLength(1)
    expect(surviving[0]!.hp).toEqual(specs[1]!.hp)
    expect(surviving[0]!.weapons).toEqual(specs[1]!.weapons)
    expect(off.expeditionFoe.strength.hp).toBeLessThan(full.expeditionFoe.strength.hp)
    expect(off.expeditionFoe.strength.dps).toBeLessThan(full.expeditionFoe.strength.dps)
    expect(off.threat).toBeLessThan(full.threat)
    const battle = createBattleState({ ...specs[0]!, tag: 'player', side: 'me', weapons: [] }, specs, 0, 1000)
    const tender = battle.units[specs[0]!.tag]!
    const head = battle.units[specs[1]!.tag]!
    tender.hp.a /= 2
    head.hp.a /= 2
    const tenderBefore = tender.hp.a
    const headBefore = head.hp.a
    pulseFoeRepair(battle, specs, { pulses: 0, healed: 0 })
    expect(tender.hp.a).toBe(tenderBefore)
    expect(head.hp.a).toBeGreaterThan(headBefore)
  })
})

describe('显式近防计划与修理尺度不随展示标签翻档', () => {
  it('显式标记在公共建档与包装入口同源', () => {
    for (const family of families) {
      for (const role of roles) {
        const card = wormholeExpeditionCard(ctx, family, 10, role)
        expect(createFoeSpecs(card, bal)).toEqual(wormholeExpeditionFoeSpecs(card, bal))
      }
    }
  })

  it('普通/巡逻/事件始终无近防；第4层起精英/守卫按既有参数启用', () => {
    for (const family of families) {
      for (const role of roles) {
        for (const depth of [1, 3, 4, 10, 100]) {
          const card = wormholeExpeditionCard(ctx, family, depth, role)
          const enabled = depth >= 4 && (role === 'elite' || role === 'guard')
          const specs = wormholeExpeditionFoeSpecs(card, bal)
          expect(pdEnabledFor(card.threatJudged!, bal)).toBe(enabled)
          expect(specs.every((spec) => spec.foePointDefenseEnabled === enabled)).toBe(true)
          expect(card.expeditionFoe.pointDefense.unitTags).toEqual(enabled ? specs.map((spec) => spec.tag) : [])
          const relabeled = { ...card, threat: 1024 }
          expect(wormholeExpeditionFoeSpecs(relabeled, bal)).toEqual(specs)
        }
      }
    }
  })

  it('G修理脉冲以实际属性尺度增长一次；后勤修理来自其预算内名义DPS', () => {
    const mount = FOE_MOUNTS[FOE_MOUNT_IDS.hullRepair].repairPulse!
    for (const role of roles) {
      const card = wormholeExpeditionCard(ctx, 'G', 10, role)
      const specs = wormholeExpeditionFoeSpecs(card, bal)
      const repair = specs.filter((spec) => spec.foeRepairPulse)
      expect(repair.length).toBeGreaterThan(0)
      for (const spec of repair) {
        expect(spec.foeRepairPulse!.k).toBeCloseTo(1.36 * roleScale[role], 12)
        expect({ ...spec.foeRepairPulse, k: undefined }).toEqual({ ...mount, k: undefined })
      }
      const relabeled = { ...card, threat: 1024, threatJudged: 1024 }
      expect(wormholeExpeditionFoeSpecs(relabeled, bal).map((spec) => spec.foeRepairPulse))
        .toEqual(specs.map((spec) => spec.foeRepairPulse))
    }
  })
})

describe('谜质快照同源派生', () => {
  it('强度倍率同时缩放HP/DPS和修理，威胁重算、近防保持，解除支援的份额不回填', () => {
    for (const family of families) {
      for (const role of roles) {
        for (const disabled of [false, true]) {
          const original = wormholeExpeditionCard(ctx, family, 10, role, disabled)
          const before = structuredClone(original)
          const modified = wormholeExpeditionModifyCard(original, bal, { threatMul: 0.5 })
          expect(original).toEqual(before)
          expect(modified).not.toBe(original)
          const strength = wormholeExpeditionStrengthOf(modified, bal)
          expect(strength.hp).toBeCloseTo(original.expeditionFoe.strength.hp * 0.5, 8)
          expect(strength.dps).toBeLessThanOrEqual(original.expeditionFoe.strength.dps * 0.5 + 1e-8)
          expect(strength.dps / (original.expeditionFoe.strength.dps * 0.5)).toBeGreaterThan(0.99)
          expect(modified.expeditionFoe.strength).toEqual(strength)
          expect(modified.expeditionFoe.budget.hp).toBeCloseTo(original.expeditionFoe.budget.hp * 0.5, 8)
          expect(modified.expeditionFoe.budget.dps).toBeCloseTo(original.expeditionFoe.budget.dps * 0.5, 8)
          expect(modified.threat).toBe(foeThreatRatingOf(strength.x, 10, bal))
          expect(modified.threat).toBeLessThan(original.threat)
          expect(modified.threatJudged).toBe(original.threatJudged)
          expect(modified.wormholePdTags).toEqual(original.wormholePdTags)
          expect(modified.wormholeRepairScale).toBe(original.wormholeRepairScale * 0.5)
          expect(createFoeSpecs(modified, bal)).toEqual(wormholeExpeditionFoeSpecs(modified, bal))
        }
      }
    }
  })

  it('命中和近盲带修改实际槽位，光束必中、机型命中沿用现有机制', () => {
    for (const family of families) {
      const source = wormholeExpeditionCard(ctx, family, 7, 'elite')
      const original = createFoeSpecs(source, bal)
      const changed = wormholeExpeditionModifyCard(source, bal, { foeHitDown: 0.25, blindReduce: 0.1 })
      const specs = createFoeSpecs(changed, bal)
      expect(changed.expeditionFoe.strength).toEqual(source.expeditionFoe.strength)
      specs.forEach((spec, index) => {
        const old = original[index]!
        const gun = spec.weapons[0]!
        expect(gun.hitRate).toBeCloseTo(gun.kind === 'beam' ? 1 : old.weapons[0]!.hitRate - 0.25, 10)
        expect(gun.blindDmgMul).toBeCloseTo(old.weapons[0]!.blindDmgMul! - 0.1, 10)
        expect(spec.weapons.slice(1)).toEqual(old.weapons.slice(1))
      })
      const floor = createFoeSpecs(wormholeExpeditionModifyCard(source, bal, { foeHitDown: 10, blindReduce: 10 }), bal)
      expect(floor.every((spec) => spec.weapons[0]!.blindDmgMul === 0)).toBe(true)
      expect(floor.every((spec) => spec.weapons[0]!.hitRate === (spec.weapons[0]!.kind === 'beam' ? 1 : 0))).toBe(true)
      expect(wormholeExpeditionModifyCard(source, bal, {})).toEqual(source)
    }
  })

  it('非法倍率/非有限修正拒绝，不污染输入', () => {
    const source = wormholeExpeditionCard(ctx, 'D', 10, 'guard')
    const before = structuredClone(source)
    for (const mods of [{ threatMul: 0 }, { threatMul: -1 }, { threatMul: NaN }, { foeHitDown: Infinity }, { blindReduce: -1 }]) {
      expect(() => wormholeExpeditionModifyCard(source, bal, mods)).toThrow('mods-invalid')
    }
    expect(source).toEqual(before)
  })
})

describe('交付工具读数', () => {
  it('打印五族第1/10层与第10层解除支援读数，不接触个人档', () => {
    const rows = families.flatMap((family) => roles.filter((role) => ['ordinary', 'elite', 'guard'].includes(role))
      .flatMap((role) => [1, 10].map((depth) => {
        const card = wormholeExpeditionCard(ctx, family, depth, role)
        const off = wormholeExpeditionCard(ctx, family, depth, role, true)
        return {
          family, role, depth,
          hp: Number(card.expeditionFoe.strength.hp.toFixed(2)),
          dps: Number(card.expeditionFoe.strength.dps.toFixed(2)),
          threat: card.threat,
          pd: card.expeditionFoe.pointDefense.unitTags.length,
          offHp: Number(off.expeditionFoe.strength.hp.toFixed(2)),
          offDps: Number(off.expeditionFoe.strength.dps.toFixed(2)),
          offThreat: off.threat,
        }
      })))
    console.table(rows)
    expect(rows).toHaveLength(30)
    expect(hpOf(active(wormholeExpeditionCard(ctx, 'D', 10, 'guard')))).toBeGreaterThan(0)
  })
})
