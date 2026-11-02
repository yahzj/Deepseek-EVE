import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { fitModule } from '../src/equipment'
import { rangeEwBaseOf, rangeEwCutOf, playerRangeEwOf, rangeEwContestOf, foeRangeEwOf, syncRangeEw } from '../src/combat/rangeEw'
import { rangeEwPreviewOf, rangeEwBattleView } from '../src/combat/rangeEwPreview'
import { createFoeSpecs, activeFoeSpecsOf } from '../src/combat/foes/catalog'
import { startFleetBattleFor } from '../src/combat/startFleet'
import { advanceBattleFor } from '../src/combat/advance'
import { resolvedBattleAnomaly } from '../src/combat/cards'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { foeGunMaxRangeOf, meJammerNetOf, applyMeJammerDebuff } from '../src/combat/foeRange'
import { createPlayerSpec } from '../src/combat/player/create'
import { createBattleState } from '../src/combat/foes/state'
import { startBattleFor } from '../src/combat/startSingle'
import { battleOpenM } from '../src/combat/foes/tactics'
import { foeRangeEwSpecsOf, foeGunPowerFactorOf } from '../src/combat/foeRange'
import { applyMeWebDebuff } from '../src/combat/captureWebs'
import { distFactor } from '../src/combat/combatMath'
import { buildMyUnitSpecs } from '../src/combat/fleetSpecs'

const ctx = buildSimContext()
function setup() {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.fleet = {}
  state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, 5]))
  const id = addShipToFleet(state, 'sh-wh-d-frigate')
  state.shipId = id
  state.moduleBay['mod-lair-ecm-h'] = 1
  expect(fitModule(state, 'mod-lair-ecm-h', ctx).ok).toBe(true)
  state.warehouse.items['ammo-kinetic-l'] = 10000
  return { state, id }
}

describe('射程电子战强度', () => {
  it('敌我全舰级基础5/10/15/20/30，非战斗舰不例外', () => {
    expect([1, 2, 3, 4, 5].map(rangeEwBaseOf)).toEqual([5, 10, 15, 20, 30])
    const { state } = setup()
    for (const ship of ctx.ships.values()) {
      const uid = addShipToFleet(state, ship.id)
      expect(playerRangeEwOf(state, ctx, [uid])[0]!.base).toBe(rangeEwBaseOf(ship.tier))
    }
  })

  it('S曲线零点平缓、中段加速、末端收敛，有限净强度低于60%', () => {
    expect(rangeEwCutOf(0)).toBe(0)
    expect(rangeEwCutOf(40)).toBeCloseTo(.06)
    expect(rangeEwCutOf(120)).toBeCloseTo(.3)
    expect(rangeEwCutOf(240)).toBeCloseTo(.48)
    expect(rangeEwCutOf(40) - rangeEwCutOf(20)).toBeGreaterThan(rangeEwCutOf(20))
    expect(rangeEwCutOf(600) - rangeEwCutOf(580)).toBeLessThan(rangeEwCutOf(120) - rangeEwCutOf(100))
    for (let s = 1; s <= 10000; s++) {
      expect(rangeEwCutOf(s)).toBeGreaterThan(rangeEwCutOf(s - 1))
      expect(rangeEwCutOf(s)).toBeLessThan(.6)
    }
  })

  it('电子舰基础5＋额外40＋40点装备×1.25＝95，普通舰装备不吃加成', () => {
    const { state, id } = setup()
    expect(playerRangeEwOf(state, ctx, [id])[0]).toMatchObject({ base: 5, extra: 40, equipment: 40, equipmentMul: 1.25, total: 95 })
    const normal = addShipToFleet(state, 'sh-hammerhead')
    state.moduleBay['mod-lair-ecm-h'] = 1
    expect(fitModule(state, 'mod-lair-ecm-h', ctx, { shipId: normal }).ok).toBe(true)
    expect(playerRangeEwOf(state, ctx, [normal])[0]).toMatchObject({ base: 15, extra: 0, equipment: 40, equipmentMul: 1, total: 55 })
    expect(playerRangeEwOf(state, ctx, [id, id])).toHaveLength(1)
  })

  it('先抵消原始强度，等强归零且只有弱势方受压', () => {
    const { state, id } = setup()
    const part = playerRangeEwOf(state, ctx, [id])
    expect(rangeEwContestOf(part, part)).toMatchObject({ net: 0, meCut: 0, foeCut: 0 })
    const foe = [{ ...part[0]!, total: 215 }]
    expect(rangeEwContestOf(part, foe)).toMatchObject({ net: -120, meCut: .3, foeCut: 0 })
    expect(rangeEwContestOf(foe, part)).toMatchObject({ net: 120, meCut: 0, foeCut: .3 })
  })

  it('旗舰末波分别7舰，新增干扰舰和碑卫保留完整电子战能力，旧卡不变', () => {
    const ink = ctx.anomalies.get('ink-flagship')!, grave = ctx.anomalies.get('gravekeeper-flagship')!
    expect(ink.waves!.map(w => w.units)).toEqual([6, 6, 5, 7])
    expect(grave.waves!.map(w => w.units)).toEqual([5, 4, 4, 7])
    const inkSpecs = activeFoeSpecsOf(ink, ctx.balance.battle, 3)
    const graveSpecs = activeFoeSpecsOf(grave, ctx.balance.battle, 3)
    expect(inkSpecs.filter(s => s.foeShipId === 'foe-h-ink-jammer')).toHaveLength(2)
    expect(inkSpecs.filter(s => s.foeShipId === 'foe-h-ink-jammer').every(s => s.rangeEwStrength === 120 && s.foeCaptureWeb)).toBe(true)
    expect(graveSpecs.filter(s => s.foeShipId === 'foe-d-invasion-bastion')).toHaveLength(3)
    expect(graveSpecs.filter(s => s.foeShipId === 'foe-d-invasion-bastion').every(s => s.rangeEwStrength === 80)).toBe(true)
    expect(inkSpecs.reduce((sum, spec) => sum + foeRangeEwOf(spec).total, 0)).toBe(485)
    expect(graveSpecs.reduce((sum, spec) => sum + foeRangeEwOf(spec).total, 0)).toBe(355)
    expect(ink.rangeEwLegacyCard!.waves!.map(w => w.units)).toEqual([6, 6, 5, 6])
  })

  it('在场存活双方才计入，死亡失效、恢复后生效，未到场支援不提前计入', () => {
    const { state, id } = setup()
    const battle = startFleetBattleFor(state, ctx, [id], 'wh-grave-throne')!
    const card = resolvedBattleAnomaly(ctx, battle, 'wh-grave-throne')!
    const foes = createFoeSpecs(card, ctx.balance.battle)
    const first = syncRangeEw(state, ctx, battle, foes)
    expect(first.foe).toHaveLength(1)
    expect(first.meStrength).toBe(95)
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    expect(syncRangeEw(state, ctx, battle, foes).meStrength).toBe(0)
    battle.units.player!.hp.h = 1
    expect(syncRangeEw(state, ctx, battle, foes).meStrength).toBe(95)
  })

  it('战外逐波预览与开场实际一致，不改变状态、库存、随机序列或距离记忆', () => {
    const { state, id } = setup()
    const before = structuredClone(state), card = ctx.anomalies.get('ink-flagship')!
    const preview = rangeEwPreviewOf(state, ctx, card, [id])
    expect(state).toEqual(before)
    expect(preview).toHaveLength(4)
    expect(preview[3]!.view.foeStrength).toBeGreaterThan(0)
    expect(preview[3]!.view.foe).toHaveLength(7)
    const battle = startFleetBattleFor(state, ctx, [id], card.id)!
    const actual = rangeEwBattleView(state, ctx, battle, card)!
    expect(actual.net).toBe(preview[0]!.view.net)
    expect(actual.weapons).toHaveLength(preview[0]!.view.weapons.length)
  })

  it('带增程武器显示真实射程差，不把压制系数当相对降幅', () => {
    const { state, id } = setup()
    const spec = createPlayerSpec(state, ctx, id)!
    spec.weapons = [{ kind: 'fixed', label: 'probe', minRangeM: 0, maxRangeM: 12000, reloadMs: 1000, hitRate: 1, falloff: 1 }]
    applyMeJammerDebuff(spec, .3, [{ baseM: 10000, bonusMul: 1.2 }])
    expect(spec.weapons[0]!.maxRangeM).toBe(9000)
  })

  it('单舰无编队字段时，原拍沉没与复活也刷新缓存；未到场舰不贡献', () => {
    const { state, id } = setup()
    const card = ctx.anomalies.get('ink-flagship')!
    const foes = activeFoeSpecsOf(card, ctx.balance.battle, 3)
    const battle = createBattleState(createPlayerSpec(state, ctx, id)!, foes, 0, 0)
    battle.rangeEwVersion = 1
    expect(syncRangeEw(state, ctx, battle, foes).meStrength).toBe(95)
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    expect(syncRangeEw(state, ctx, battle, foes).meStrength).toBe(0)
    battle.units.player!.hp.h = 1
    expect(syncRangeEw(state, ctx, battle, foes).meStrength).toBe(95)
    const jammer = foes.find(foe => foe.foeShipId === 'foe-h-ink-jammer')!
    const total = syncRangeEw(state, ctx, battle, foes).foeStrength
    battle.units[jammer.tag]!.enteredAtMs = 100
    expect(syncRangeEw(state, ctx, battle, foes).foeStrength).toBe(total - foeRangeEwOf(jammer).total)
    battle.lastTickGameMs = 100
    expect(syncRangeEw(state, ctx, battle, foes).foeStrength).toBe(total)
    battle.units[jammer.tag]!.hp = { s: 0, a: 0, h: 0 }
    expect(syncRangeEw(state, ctx, battle, foes).foeStrength).toBe(total - foeRangeEwOf(jammer).total)
  })

  it('互斥支援逐分支预览且各有武器详情，不把未来两支合并', () => {
    const { state, id } = setup()
    const card = ctx.anomalies.get('wh-grave-throne')!
    const before = structuredClone(state)
    const rows = rangeEwPreviewOf(state, ctx, card, [id])
    expect(rows.map(row => row.phase)).toEqual(['opening', 'inside', 'outside'])
    const specs = activeFoeSpecsOf(card, ctx.balance.battle, 0)
    for (const row of rows) {
      const expected = specs.filter(spec => !spec.foeReinforceAt || spec.foeReinforceBranch === row.phase)
      expect(row.view.foe.map(part => part.id)).toEqual(expected.map(spec => spec.tag))
      expect(row.view.foeStrength).toBe(expected.reduce((sum, spec) => sum + foeRangeEwOf(spec).total, 0))
      expect(row.view.weapons.filter(weapon => weapon.side === 'foe').length).toBeGreaterThan(0)
    }
    expect(state).toEqual(before)
  })

  it('多舰预览与实际主控排序同源，去重后全编队计入', () => {
    const { state, id } = setup()
    const other = addShipToFleet(state, 'sh-hammerhead')
    const card = ctx.anomalies.get('ink-flagship')!
    const preview = rangeEwPreviewOf(state, ctx, card, [other, id, other])[0]!.view
    const battle = startFleetBattleFor(state, ctx, [other, id], card.id)!
    expect(preview.me.map(part => part.id)).toEqual([id, other])
    expect(preview.meStrength).toBe(battle.rangeEw!.meStrength)
    expect(preview.net).toBe(battle.rangeEw!.net)
  })

  it('详情保留逐件增程和捕获网，展开不写状态；网解除后同强度也刷新射程', () => {
    const { state, id } = setup()
    const ship = ctx.ships.get(state.fleet[id]!.defId!)!
    const local = { ...ctx, ships: new Map(ctx.ships).set(ship.id,
      { ...ship, weaponRangeBonusPct: { ...ship.weaponRangeBonusPct, kinetic: .2 } }) }
    state.moduleBay['mod-turret-kin-2'] = 1
    expect(fitModule(state, 'mod-turret-kin-2', local).ok).toBe(true)
    const card = ctx.anomalies.get('ink-flagship')!
    const foes = activeFoeSpecsOf(card, ctx.balance.battle, 3)
    const battle = createBattleState(createPlayerSpec(state, local, id)!, foes, 0, 0)
    battle.rangeEwVersion = 1
    battle.waveIdx = 3
    battle.meWebDebuffs = { player: { byTag: foes[0]!.tag, slowMul: .1, noThruster: true,
      noEvasion: true, rangeDownM: 500, atMs: 0 } }
    syncRangeEw(state, local, battle, foes)
    const snapshot = structuredClone(battle), stateBefore = structuredClone(state)
    const view = rangeEwBattleView(state, local, battle, card)!
    expect(battle).toEqual(snapshot)
    expect(state).toEqual(stateBefore)
    const refs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }> }
    const raw = createPlayerSpec(state, local, id, undefined, refs)!
    applyMeWebDebuff(raw, battle.meWebDebuffs.player!)
    const expected = applyMeJammerDebuff(structuredClone(raw), view.meCut, refs.weaponRanges)
    const at = raw.weapons.findIndex(weapon => weapon.moduleId === 'mod-turret-kin-2')
    expect(refs.weaponRanges[at]!.bonusMul).toBeGreaterThan(1)
    const row = view.weapons.find(weapon => weapon.id === 'player:mod-turret-kin-2')!
    expect(row.beforeM).toBe(raw.weapons[at]!.maxRangeM)
    expect(row.currentM).toBe(expected.weapons[at]!.maxRangeM)
    expect(row.reduction).toBeCloseTo(1 - row.currentM / row.beforeM)
    expect(row.reduction).toBeLessThan(view.meCut)
    delete battle.meWebDebuffs
    const unwebbed = rangeEwBattleView(state, local, battle, card)!.weapons.find(weapon => weapon.id === row.id)!
    expect(unwebbed.beforeM).toBe(row.beforeM + 500)
    expect(unwebbed.currentM).toBeGreaterThan(row.currentM)
  })

  it('单舰与多舰开战距离都取压制后双方射程，延迟支援不参与', () => {
    for (const fleet of [false, true]) {
      for (const cardId of ['ink-flagship', 'wh-grave-throne']) {
        const { state, id } = setup()
        const battle = fleet ? startFleetBattleFor(state, ctx, [id], cardId)! : startBattleFor(state, ctx, id, cardId)!
        const card = resolvedBattleAnomaly(ctx, battle, cardId)!
        const foes = activeFoeSpecsOf(card, ctx.balance.battle, 0)
        const me = buildMyUnitSpecs(state, ctx, battle, id, card.id, foes)[0]!
        expect(battle.distanceM).toBe(battleOpenM(me, foeRangeEwSpecsOf(battle, foes), ctx.balance.battle))
      }
    }
  })

  it('敌方压制后的远端衰减使用有效射程，下限保持3000米', () => {
    const { state, id } = setup()
    const battle = startFleetBattleFor(state, ctx, [id], 'ano-training')!
    const foe = createFoeSpecs(ctx.anomalies.get('ano-training')!, ctx.balance.battle)[0]!
    battle.rangeEw = { ...battle.rangeEw!, foeCut: .3 }
    const weapon = { minRangeM: 1000, maxRangeM: 10000, falloff: .3 }
    expect(foeGunMaxRangeOf(battle, foe, weapon)).toBe(7000)
    expect(foeGunPowerFactorOf(battle, foe, weapon, 6000)).toBeCloseTo(distFactor(6000, { ...weapon, maxRangeM: 7000 }))
    expect(foeGunMaxRangeOf(battle, foe, { maxRangeM: 3100 })).toBe(3000)
    expect(foeGunMaxRangeOf(battle, foe, { maxRangeM: 2000 })).toBe(2000)
  })

  it('新规则版本随档，缺版本旧战斗沿用原旗舰阵容与百分比压制', () => {
    const { state, id } = setup()
    const battle = startFleetBattleFor(state, ctx, [id], 'ink-flagship')!
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: 'ink-flagship', battle }
    const back = loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle!
    expect(back.rangeEwVersion).toBe(1)
    expect(back.rangeEw).toBeUndefined()
    delete back.rangeEwVersion
    expect(resolvedBattleAnomaly(ctx, back, 'ink-flagship')!.waves!.map(w => w.units)).toEqual([6, 6, 5, 6])
    back.meFoeRangeDebuff = .15
    expect(meJammerNetOf(back, [{ ...createFoeSpecs(ctx.anomalies.get('ano-training')!, ctx.balance.battle)[0]!, foeRangeDebuffPct: .5 }])).toBeCloseTo(.35)
    expect(foeGunMaxRangeOf(back, {}, { maxRangeM: 10000 })).toBe(8500)
  })

  it('推进和战内读数同源，至少完成一次真实步进', () => {
    const { state, id } = setup()
    const battle = startFleetBattleFor(state, ctx, [id], 'ano-pirate-post')!
    state.gameMs = 1000
    advanceBattleFor(state, ctx, battle, id, 'ano-pirate-post')
    expect(battle.lastTickGameMs).toBeGreaterThan(0)
    const card = resolvedBattleAnomaly(ctx, battle, 'ano-pirate-post')!
    const view = rangeEwBattleView(state, ctx, battle, card)!
    expect(view.foeCut).toBeCloseTo(battle.rangeEw!.foeCut)
  })
})
