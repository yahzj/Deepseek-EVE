import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createFoeSpecs, foeStrengthOf } from '../src/combat/foes/catalog'
import { enemyFormationCard } from '../src/combat/formation'
import { battleAnomalyOf, wormholeDerivedAnomaly, applyFoeOverride, resolvedBattleAnomaly } from '../src/combat/cards'
import { foeMultiShipCompMul } from '../src/combat/foePower'
import { lairAnomalyOf } from '../src/lairs'
import { bountyEnemyCount } from '../src/salvage'
import { createInitialState } from '../src/state'
import { startFleetBattleFor } from '../src/combat/startFleet'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { injectCommandFleetAllShipsFixture } from '../../../tools/command-fleet-all-ships-fixture'
import { advanceBattleFor } from '../src/combat/advance'
import { activeFoeSpecsOf } from '../src/combat/foes/catalog'
import { createBattleState } from '../src/combat/foes/state'
import { foesWithSupport, resolveFoeRevive } from '../src/combat/foes/reinforcements'
import { createPlayerSpec } from '../src/combat/player/create'
import { foeJudgedThreatOf } from '../src/combat/foePower'
import { factionAnomalyOf } from '../src/lairs'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const cards = [...ctx.anomalies.values()].filter(card => card.foeFormation)
const signal = [...ctx.anomalies.values()].filter(card => card.id.startsWith('wh-'))
const strength = (card: Parameters<typeof createFoeSpecs>[0]) => foeStrengthOf(card, bal)

describe('敌卡扩编保留旧单舰规格', () => {
  it.each(cards)('$id 血与火力不降、回收体量不变、补偿不再跟随新数量', card => {
    const baseline = card.foeFormation!.baseline
    const before = strength(baseline)
    const after = strength(card)
    expect(after.hp).toBeGreaterThanOrEqual(before.hp)
    expect(after.dps).toBeGreaterThanOrEqual(before.dps)
    expect(card.threat).toBeGreaterThanOrEqual(baseline.threat)
    expect(bountyEnemyCount(card)).toBe(bountyEnemyCount(baseline))
    expect(foeMultiShipCompMul(card)).toBe(1)
    for (const wave of new Set((card.ships ?? []).map(slot => slot.wave ?? 0))) {
      const specs = createFoeSpecs(card, bal, { tagPrefix: wave ? `w${wave}-` : '' })
      expect(specs.length).toBe(card.waves![wave]!.units)
      expect(new Set(specs.map(spec => spec.tag)).size).toBe(specs.length)
    }
    const unchanged = enemyFormationCard(baseline, bal, {})
    for (const wave of new Set(baseline.ships!.map(slot => slot.wave ?? 0))) {
      const opts = { tagPrefix: wave ? `w${wave}-` : '' }
      const normalize = (spec: ReturnType<typeof createFoeSpecs>[number]) => {
        const { foeFormationAdded, ...rest } = spec
        return rest
      }
      expect(createFoeSpecs(unchanged, bal, opts).map(normalize)).toEqual(createFoeSpecs(baseline, bal, opts))
    }
  })

  it.each(cards.filter(card => card.lairCore))('$id 窝点各档均不弱于原窝点且不叠常驻扩编', card => {
    for (const tier of [1, 2, 3] as const) {
      const old = lairAnomalyOf(card.foeFormation!.baseline, tier, bal, 0)
      const next = lairAnomalyOf(card, tier, bal, 1, ctx.foeShips)
      expect(strength(next).hp).toBeGreaterThanOrEqual(strength(old).hp)
      expect(strength(next).dps).toBeGreaterThanOrEqual(strength(old).dps)
      expect(bountyEnemyCount(next)).toBe(bountyEnemyCount(old))
    }
  })

  it.each(signal)('$id 各层用途均不削弱，第1层保留，互斥分支仍有限', base => {
    for (const depth of [1, 2, 4, 7, 10]) for (const kind of ['node', 'boss', 'ruins'] as const) {
      const args = { depth, kind, waves: 1 }
      const old = wormholeDerivedAnomaly(ctx, base, args, 0)
      const next = wormholeDerivedAnomaly(ctx, base, args, 1)
      expect(strength(next).hp).toBeGreaterThanOrEqual(strength(old).hp)
      expect(strength(next).dps).toBeGreaterThanOrEqual(strength(old).dps)
      if (depth === 1) expect(strength(next)).toEqual(strength(old))
      const slots = next.ships!
      const always = slots.filter(slot => !slot.enterBranch).length
      const branch = Math.max(0, ...['inside', 'outside'].map(value => slots.filter(slot => slot.enterBranch === value).length))
      expect(always + branch).toBeLessThanOrEqual(8)
    }
  })

  it('被动入侵保留原编成与0.75强度，旗舰血池不再被增幅', () => {
    for (const card of cards.filter(card => card.region === 'inv')) {
      const next = applyFoeOverride(card, { strengthMul: 0.75, patrolFormation: true })
      const old = applyFoeOverride(card.foeFormation!.baseline, { strengthMul: 0.75 })
      expect(strength(next)).toEqual(strength(old))
    }
    const flagship = ctx.anomalies.get('ink-flagship')!
    const card = applyFoeOverride(flagship, { bossShipId: 'foe-h-ink-flagship', bossHp: 300_000 })
    const boss = createFoeSpecs(card, bal, { tagPrefix: 'w3-' }).find(spec => spec.foeShipId === 'foe-h-ink-flagship')!
    expect(boss.hp.s + boss.hp.a + boss.hp.h).toBe(300_000)
  })

  it('新战斗版本随档，旧战斗原卡与新卡可分别重建', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 20261031 })
    injectCommandFleetAllShipsFixture(state)
    const battle = startFleetBattleFor(state, ctx, [state.shipId], 'ano-redring-raiders')!
    expect(battle.enemyFormationVersion).toBe(1)
    state.expedition.battle = battle
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = 'ano-redring-raiders'
    const loaded = loadSaveFile(serializeSaveFile(state))
    expect(loaded.state.expedition.battle?.enemyFormationVersion).toBe(1)
    const old = battleAnomalyOf(ctx, 'ano-redring-raiders', undefined, undefined, 0)!
    expect(old.ships!.reduce((sum, slot) => sum + (slot.count ?? 1), 0)).toBe(4)
    expect(battleAnomalyOf(ctx, old.id)!.ships!.length).toBe(5)
  })

  it.each(cards.filter(card => card.foeFormation!.baseline.threat <= 100 && card.region !== 'inv'))('$id 低阶原舰逐舰属性不增幅', card => {
    for (const wave of new Set(card.ships!.map(slot => slot.wave ?? 0))) {
      const before = activeFoeSpecsOf(card.foeFormation!.baseline, bal, wave)
      const originals = activeFoeSpecsOf(card, bal, wave).filter(unit => !unit.foeFormationAdded)
      expect(originals.map(unit => ({ hp: unit.hp, weapons: unit.weapons, speed: unit.speedMps, resists: unit.resists })))
        .toEqual(before.map(unit => ({ hp: unit.hp, weapons: unit.weapons, speed: unit.speedMps, resists: unit.resists })))
    }
  })

  it.each(Object.entries({
    'ink-harass': [6], 'ink-raid': [3, 4], 'ink-main': [4, 7], 'ink-flagship': [6, 6, 5, 7],
    'corona-drift': [7], 'corona-split': [4, 4], 'corona-converge': [4, 7], 'corona-nexus': [6, 6, 5, 6],
    'alien-vanguard': [5, 7], 'alien-escort': [4, 7], 'alien-main': [4, 9], 'alien-broodmother': [4, 5, 5, 6],
    'gravekeeper-drift': [4, 3], 'gravekeeper-line': [3, 5], 'gravekeeper-main': [4, 3, 4], 'gravekeeper-flagship': [5, 4, 4, 7],
  }))('%s 主动入侵逐波数量符合批准编成', (id, counts) => {
    expect(ctx.anomalies.get(id)!.waves!.map(wave => wave.units)).toEqual(counts)
  })

  it('新增护航不携带控制、复活、孵化和支援能力，显示挂载与真实挂载一致', () => {
    const derived = [...cards, ...signal.flatMap(base => [2, 7, 10].map(depth => wormholeDerivedAnomaly(ctx, base, { depth, kind: 'boss', waves: 1 }))),
      ...cards.filter(card => card.lairCore).flatMap(base => [1, 2, 3].map(tier => lairAnomalyOf(base, tier as 1 | 2 | 3, bal, 1, ctx.foeShips)))]
    for (const card of derived) for (const wave of new Set(card.ships!.map(slot => slot.wave ?? 0))) {
      for (const spec of activeFoeSpecsOf(card, bal, wave).filter(unit => unit.foeFormationAdded)) {
        expect(spec.foeCaptureWeb, card.id).toBeUndefined()
        expect(spec.foeRangeDebuffPct, card.id).toBeUndefined()
        expect(spec.foeReviveEscort, card.id).toBeUndefined()
        expect(spec.foeSummonEscort, card.id).toBeUndefined()
        expect(spec.foeHatchery, card.id).toBeUndefined()
        expect(spec.foeSupportCall, card.id).toBeUndefined()
        expect(spec.foeMountNamePairs?.map(pair => pair[0])).toEqual(spec.foeMountNames)
      }
    }
  })

  it.each(['alien-broodmother', 'gravekeeper-flagship'])('%s 新增护航阵亡不扩大原召唤额度', id => {
    const state = createInitialState({ nowWallMs: 0, seed: 3110 })
    const card = ctx.anomalies.get(id)!, foes = activeFoeSpecsOf(card, bal, 3)
    const summoner = foes.find(unit => unit.foeSummonEscort || unit.foeReviveEscort)!
    const battle = createBattleState(createPlayerSpec(state, ctx, state.shipId)!, foes, 0, 200)
    battle.enemyFormationVersion = 1
    battle.lastTickGameMs = state.gameMs = 60_000
    battle.foeAbilityClocks = { [summoner.tag]: 60_000 }
    for (const spec of foes.filter(unit => unit.foeFormationAdded)) battle.units[spec.tag]!.hp = { s: 0, a: 0, h: 0 }
    resolveFoeRevive(state, battle, foes, bal, 60_000)
    expect(battle.foeReviveCount ?? 0).toBe(0)
    for (const spec of foes.filter(unit => unit !== summoner)) battle.units[spec.tag]!.hp = { s: 0, a: 0, h: 0 }
    battle.lastTickGameMs = state.gameMs = 120_000
    battle.foeAbilityClocks = { [summoner.tag]: 120_000 }
    resolveFoeRevive(state, battle, foes, bal, 120_000)
    // 本次指定碑卫为完整新增舰，进入合法候选；普通扩编护航仍不进入。
    const expected = id === 'gravekeeper-flagship' ? 4 : 3
    expect(battle.foeReviveCount).toBe(expected)
    expect(foesWithSupport(battle, foes).filter(unit => unit.tag.startsWith('sup'))).toHaveLength(expected)
  })

  it.each([0, 1] as const)('版本%s 关闭换波演出窗口时，读档与在线/整段推进一致', version => {
    const local = { ...ctx, balance: { ...ctx.balance, battle: { ...bal, waveEnterGapMs: 0 } } }
    const state = createInitialState({ nowWallMs: 0, seed: 3110 })
    injectCommandFleetAllShipsFixture(state)
    const id = 'ano-lantern-saboteurs'
    const battle = startFleetBattleFor(state, local, [state.shipId], id, 0, null, undefined, undefined, false, version)!
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: id, battle }
    for (const unit of Object.values(battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    const online = structuredClone(loaded)
    loaded.gameMs = 12_000
    advanceBattleFor(loaded, local, loaded.expedition.battle!, loaded.shipId, id)
    for (let time = 100; time <= 12_000; time += 100) {
      online.gameMs = time
      advanceBattleFor(online, local, online.expedition.battle!, online.shipId, id)
    }
    expect(loaded.expedition.battle!.waveIdx).toBe(1)
    expect(online.expedition.battle!.units).toEqual(loaded.expedition.battle!.units)
    expect(online.expedition.battle!.stats).toEqual(loaded.expedition.battle!.stats)
    const card = resolvedBattleAnomaly(local, loaded.expedition.battle!, id)!
    expect(activeFoeSpecsOf(card, bal, 1)).toHaveLength(version === 1 ? 3 : 2)
    expect(foeJudgedThreatOf(card)).toBe(foeJudgedThreatOf(card.foeFormation?.baseline ?? card))
  })

  it('巡游标记随档，窝点与旗舰视图使用同一场实际卡', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3110 })
    injectCommandFleetAllShipsFixture(state)
    const battle = startFleetBattleFor(state, ctx, [state.shipId], 'ink-harass', 0, null, undefined, { strengthMul: .75, patrolFormation: true })!
    state.expedition.battle = battle
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = 'ink-harass'
    const back = loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle!
    expect(back.foeOverride?.patrolFormation).toBe(true)
    expect(createFoeSpecs(resolvedBattleAnomaly(ctx, back, 'ink-harass')!, bal)).toHaveLength(4)
  })

  it.each(signal)('$id 各实际分支的血与火力均不下调，谜质对扩编整队生效', base => {
    for (const depth of [2, 4, 7, 10]) {
      const spec = { depth, kind: 'node' as const, waves: 1 }
      const old = createFoeSpecs(wormholeDerivedAnomaly(ctx, base, spec, 0), bal)
      const current = createFoeSpecs(wormholeDerivedAnomaly(ctx, base, spec, 1), bal)
      const weakened = createFoeSpecs(wormholeDerivedAnomaly(ctx, base, { ...spec, threatMul: .5, foeHitDown: .2, blindReduce: .1 }, 1), bal)
      const measure = (units: typeof old, branch: string) => {
        const active = units.filter(unit => !unit.foeReinforceBranch || unit.foeReinforceBranch === branch)
        return { hp: active.reduce((sum, unit) => sum + unit.hp.s + unit.hp.a + unit.hp.h, 0),
          dps: active.reduce((sum, unit) => sum + unit.weapons.reduce((dps, w) => dps + (w.shotDmg ?? 0) * (w.count ?? 1) * 1000 / w.reloadMs, 0), 0) }
      }
      for (const branch of ['inside', 'outside']) {
        expect(measure(current, branch).hp).toBeGreaterThanOrEqual(measure(old, branch).hp)
        expect(measure(current, branch).dps).toBeGreaterThanOrEqual(measure(old, branch).dps)
        expect(measure(weakened, branch).hp).toBeLessThan(measure(current, branch).hp)
        expect(measure(weakened, branch).dps).toBeLessThan(measure(current, branch).dps)
      }
      expect(weakened).toHaveLength(current.length)
      expect(current.filter(unit => unit.foeFormationAdded && unit.foeReinforceBranch).length).toBe(base.id === 'wh-grave-throne' ? 2 : 0)
    }
  })

  it('派系活跃修理倍率保留原判据增幅，重标显示威胁不再放大修理', () => {
    const signal = wormholeDerivedAnomaly(ctx, ctx.anomalies.get('wh-exile-blockade')!, { depth: 7, kind: 'node', waves: 1 })
    const card = factionAnomalyOf(signal)
    const specs = createFoeSpecs(card, bal)
    for (const unit of specs) expect(unit.foeRepairPulse!.k).toBe(Math.max(1, foeJudgedThreatOf(card) / 45))
  })

  it.each([0, 1] as const)('版本%s 默认演出窗口下读档前后相同时间步换波一致', version => {
    const state = createInitialState({ nowWallMs: 0, seed: 3110 })
    injectCommandFleetAllShipsFixture(state)
    const id = 'ano-lantern-saboteurs'
    const battle = startFleetBattleFor(state, ctx, [state.shipId], id, 0, null, undefined, undefined, false, version)!
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: id, battle }
    for (const unit of Object.values(battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    for (let time = 100; time <= 12_000; time += 100) for (const sample of [state, back]) {
      sample.gameMs = time
      advanceBattleFor(sample, ctx, sample.expedition.battle!, sample.shipId, id)
    }
    expect(back.expedition.battle!.units).toEqual(state.expedition.battle!.units)
    expect(back.expedition.battle!.stats).toEqual(state.expedition.battle!.stats)
  })
})
