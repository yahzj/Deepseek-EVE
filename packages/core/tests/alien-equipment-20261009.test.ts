import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { fitModule, stackWeight, weightedSum } from '../src/equipment'
import { createPlayerSpec, createFoeSpecs, createBattleState, advanceBattleFor, battleArcsFor, applyMeWebDebuff, carryVolleyOverflow } from '../src/combat'
import { acidResistsOf, addFoeAcidLayer, expireFoeAcidLayers, battleSpeedBonusOf, foeAcidRowsOf } from '../src/alienEquipment'
import { cleanBattle } from '../src/saveBattleClean'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { recycleProfileOf, rollRareBoxExtra, RARE_WRECK_VOLUME_M3, RECYCLE_CYCLE_MS, RARE_BOX_GEAR_CHANCE } from '../src/salvage'
import { advanceRefining, startRecycleRun } from '../src/industry'
import { addWare, countWare } from '../src/inventory'
import { FOE_LAIR_GEAR } from '../src/lairs'
import { fittedEffectParamsOf } from '../src/foeRange'
import { makeTestCtx, ship, anomaly } from './helpers'
import type { FoeShipDef } from '../src/types'

const ctx = buildSimContext()
const acidId = 'mod-alien-acid-launcher', speedId = 'mod-alien-pressure-chamber'
const effect = ctx.modules.get(acidId)!.acidOnHit!

function player(high: string[] = [], low: string[] = []) {
  const state = createInitialState({ nowWallMs: 0, seed: 17 })
  const uid = addShipToFleet(state, 'sh-wh-e-carrier')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  for (const id of [...high, ...low]) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    expect(fitModule(state, id, ctx, { shipId: uid }).ok).toBe(true)
  }
  const spec = createPlayerSpec(state, ctx, uid)!
  const battle = createBattleState(spec, [{ ...spec, tag: 'foe-0', side: 'foe' }], 0, 2000)
  battle.distanceM = 2000
  return { state, uid, spec, battle }
}

describe('入侵装备数据与独立掉落', () => {
  it('参考H/R入侵混池：真回收炉产出新三件、通用兜底与原材料，不出旧C族件或永久图纸', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 20261009 })
    const profile = recycleProfileOf(ctx, 'wreck-rare-c-inv')!
    for (const id of ['wreck-rare-h-hi', 'wreck-rare-r-inv']) {
      expect(recycleProfileOf(ctx, id)!.tier).toBe(profile.tier)
      expect(recycleProfileOf(ctx, id)!.pool).toEqual(profile.pool)
    }
    expect(RARE_BOX_GEAR_CHANCE[profile.tier]).toBe(.1)
    const boxes = 400
    addWare(state, 'wreck-rare-c-inv', boxes * RARE_WRECK_VOLUME_M3)
    expect(startRecycleRun(state, 'wreck-rare-c-inv', 'pilot', ctx).ok).toBe(true)
    for (let i = 0; i < boxes + 5 && state.refineRuns.length; i++) {
      state.gameMs += RECYCLE_CYCLE_MS
      advanceRefining(state, ctx)
    }
    expect(countWare(state, 'wreck-rare-c-inv')).toBe(0)
    expect(state.rareBoxesOpened['wreck-rare-c-inv']).toBe(boxes)
    expect(state.moduleBay[acidId]).toBeGreaterThan(0)
    expect(state.moduleBay[speedId]).toBeGreaterThan(0)
    expect(countWare(state, 'drone-jawclaw')).toBeGreaterThan(0)
    expect(countWare(state, 'drone-jawclaw') % 10).toBe(0)
    expect(profile.rareTheme!.some(id => (state.moduleBay[id] ?? 0) > 0)).toBe(true)
    expect(countWare(state, 'min-tritanium')).toBeGreaterThan(0)
    for (const id of FOE_LAIR_GEAR.C) expect(state.moduleBay[id] ?? 0).toBe(0)
    expect(state.blueprintStock['bp-faction-drone-jawclaw'] ?? 0).toBe(0)
  })
  it('确认参数、炮台技能族和同型合并规格', () => {
    const { spec } = player([acidId, acidId], [speedId])
    const weapon = spec.weapons.find(w => w.moduleId === acidId)!
    expect(weapon).toMatchObject({ kind: 'gun', src: 'turret', count: 2, reloadMs: 9100, minRangeM: 1800, hitRate: .8, falloff: .5, acidOnHit: effect })
    const single = player([acidId]).spec.weapons.find(w => w.moduleId === acidId)!
    expect(weapon.shotsByType!.explosive).toBe(single.shotsByType!.explosive! * 2)
    expect(ctx.modules.get(acidId)!).toMatchObject({ maxRangeM: 10000, dmgMult: 12 })
    expect(ctx.modules.get(acidId)!.cpuUse).toBe(60)
    expect(ctx.modules.get(speedId)!).toMatchObject({ rack: 'low', cpuUse: 30, speedBonusPct: .05, speedRamp: { rampMs: 60000, maxBonusPct: .25 } })
    expect(ctx.items.get('drone-jawclaw')!).toMatchObject({ name: '颚钳无人机', droneClass: 'combat', dmg: 10, cpuUse: 8, hitRate: .85, maxRangeM: 5000, unitM3: 10 })
    for (const id of [acidId, speedId]) {
      expect([...ctx.blueprints.values()].some(bp => bp.moduleId === id)).toBe(false)
      expect(ctx.marketGoods.get(id)).toMatchObject({ rarity: 'exotic', playerBuyable: false })
      expect(ctx.marketGoods.get(id)!.blackMarketBuyable).not.toBe(true)
    }
    expect(ctx.marketGoods.get(acidId)!.basePrice).toBe(4800000)
    expect(ctx.marketGoods.get(speedId)!.basePrice).toBe(2800000)
    expect(ctx.marketGoods.get('bp-faction-drone-jawclaw')).toMatchObject({ basePrice: 2400000, playerBuyable: false, blackMarketBuyable: true })
  })

  it('仅入侵稀有池替换，旧C族渠道和普通池不变', () => {
    expect(recycleProfileOf(ctx, 'wreck-rare-c-inv')!.lairGear).toEqual([acidId, speedId, 'drone-jawclaw'])
    expect(recycleProfileOf(ctx, 'wreck-c-inv')!.lairGear).toBeUndefined()
    expect(recycleProfileOf(ctx, 'wreck-rare-c-lo')!.lairGear).toEqual(FOE_LAIR_GEAR.C)
    expect(FOE_LAIR_GEAR.C).toEqual(['mod-lair-armor-c', 'mod-lair-dc-c', 'mod-lair-laser-c'])
  })

  it('真实稀有掉落只抽三件，未持有优先、无人机一次10架且托管算持有', () => {
    const { state } = player()
    state.moduleBay[acidId] = 1
    state.escrowItems[speedId] = 1
    const profile = recycleProfileOf(ctx, 'wreck-rare-c-inv')!
    const counts = new Map<string, number>()
    let drones = 0
    for (let i = 0; i < 2000; i++) {
      const drop = rollRareBoxExtra(state, ctx, profile)!
      for (const id of drop.modules) counts.set(id, (counts.get(id) ?? 0) + 1)
      for (const item of drop.drones) { expect(item).toEqual({ id: 'drone-jawclaw', count: 10 }); drones++ }
      expect(drop.blueprints).toEqual([])
    }
    expect(counts.has(acidId)).toBe(false)
    expect(counts.has(speedId)).toBe(false)
    expect(drones).toBeGreaterThan(150)
    expect(drones).toBeLessThan(250)
  })
})

describe('酸蚀独立期限与恢复', () => {
  const base = { shield: { kinetic: .3 }, armor: { kinetic: .4 }, hull: { explosive: -.85 } }
  it('逐层到期不刷新，缺失抗性也可降负，触底后精确恢复', () => {
    const { battle } = player()
    addFoeAcidLayer(battle, 'foe-0', effect, 1000)
    addFoeAcidLayer(battle, 'foe-0', effect, 5000)
    const a = acidResistsOf(battle, 'foe-0', base, 15000)
    expect(a.armor!.kinetic).toBeCloseTo(.2)
    expect(a.armor!.plasma).toBeCloseTo(-.2)
    expect(a.hull!.explosive).toBe(-.9)
    expect(a.shield).toBe(base.shield)
    expect(acidResistsOf(battle, 'foe-0', base, 16000).armor!.kinetic).toBeCloseTo(.3)
    expect(acidResistsOf(battle, 'foe-0', base, 20000)).toBe(base)
    expect(base.hull.explosive).toBe(-.85)
    for (let i = 0; i < 100; i++) expect(acidResistsOf(battle, 'foe-0', base, 16000).armor!.kinetic).toBeCloseTo(.3)
  })
  it('死亡/结束清理，不转移到新目标或其他波tag', () => {
    const { battle } = player()
    addFoeAcidLayer(battle, 'foe-0', effect, 0)
    expect(acidResistsOf(battle, 'w1-foe-0', base)).toBe(base)
    battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 }
    expireFoeAcidLayers(battle)
    expect(battle.foeAcidLayers).toBeUndefined()
    addFoeAcidLayer(battle, 'foe-0', effect, 1)
    expect(battle.foeAcidLayers).toBeUndefined()
    battle.units['foe-0']!.hp.h = 10
    addFoeAcidLayer(battle, 'foe-0', effect, 2)
    battle.ended = 'foe'
    expireFoeAcidLayers(battle)
    expect(battle.foeAcidLayers).toBeUndefined()
  })
  it('致死后同拍溢火按致死前酸蚀抗性计算，结算完再清账', () => {
    const w = player()
    const first = { ...w.spec, side: 'foe' as const, tag: 'foe-0', resists: { armor: { explosive: .5 } } }
    const second = { ...first, tag: 'foe-1', resists: {} }
    const battle = createBattleState(w.spec, [first, second], 0, 2000)
    battle.distanceM = 2000
    battle.foeAcidLayers = { 'foe-0': [{ cutPct: .1, untilMs: 15000 }] }
    battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 }
    battle.units['foe-1']!.hp = { s: 1000, a: 0, h: 0 }
    const result = carryVolleyOverflow(battle, [first, second], 'foe-0', 'explosive', 200, { s: 0, a: 90, h: 0 })
    expect(result.total).toBeCloseTo(37.5, 4)
    expireFoeAcidLayers(battle)
    expect(battle.foeAcidLayers).toBeUndefined()
  })
  it('战中整档往返不刷新期限，坏层/已到期层清洗，旧档可缺字段', () => {
    const { state, battle } = player()
    addFoeAcidLayer(battle, 'foe-0', effect, 1000)
    addFoeAcidLayer(battle, 'foe-0', effect, 5000)
    battle.lastTickGameMs = 10000
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle }
    const loaded = loadSaveFile(serializeSaveFile(state, 123)).state.expedition.battle!
    expect(loaded.foeAcidLayers).toEqual(battle.foeAcidLayers)
    expect(foeAcidRowsOf(loaded)[0]).toMatchObject({ count: 2, nextSeconds: 6 })
    loaded.lastTickGameMs = 16000
    expireFoeAcidLayers(loaded)
    expect(loaded.foeAcidLayers!['foe-0']).toEqual([{ cutPct: .1, untilMs: 20000 }])
    const dirty = { ...battle, foeAcidLayers: { 'foe-0': [{ cutPct: -.1, untilMs: 19000 }, { cutPct: NaN, untilMs: 19000 }, { cutPct: .1, untilMs: 5000 }, { cutPct: .1, untilMs: 20000 }] } }
    expect(cleanBattle(dirty)!.foeAcidLayers!['foe-0']).toEqual([{ cutPct: .1, untilMs: 20000 }])
    delete battle.foeAcidLayers
    expect(cleanBattle(battle)!.foeAcidLayers).toBeUndefined()
  })
})

describe('增压速度同池折权', () => {
  it.each([[0, .05], [30000, .15], [60000, .25], [90000, .25]])('时间%sms加成%s', (now, expected) => {
    const { spec, battle } = player([], [speedId])
    battle.lastTickGameMs = now
    expect(battleSpeedBonusOf(spec, battle)).toBeCloseTo(expected)
  })
  it('混装随当前强度换排序，多拍不漂移，跨波/读档与新场复位', () => {
    const { spec, battle } = player([], [speedId, speedId, speedId, 'mod-wh-c-pulse'])
    expect(battleSpeedBonusOf(spec, battle)).toBeCloseTo(weightedSum([.1, .05, .05, .05]))
    battle.lastTickGameMs = 60000
    expect(battleSpeedBonusOf(spec, battle)).toBeCloseTo(weightedSum([.1, .25, .25, .25]))
    battle.waveIdx = 2
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    for (let i = 0; i < 100; i++) expect(battleSpeedBonusOf(spec, loaded)).toBeCloseTo(weightedSum([.1, .25, .25, .25]))
    loaded.startedAtGameMs = loaded.lastTickGameMs
    expect(battleSpeedBonusOf(spec, loaded)).toBeCloseTo(weightedSum([.1, .05, .05, .05]))
  })
  it('初始装后读数同权重，峰值不错误复用初始权重，未装装备路径不变', () => {
    const w = player([], [speedId, speedId])
    const rows = fittedEffectParamsOf(w.state, ctx, w.uid, ctx.modules.get(speedId)!, 2)
    expect(rows.find(row => row.key === 'speed')!.eff).toBeCloseTo(.05 * stackWeight(2))
    expect(rows.some(row => row.key === 'speedPeak')).toBe(false)
    expect(battleSpeedBonusOf({ thrusterBoost: .6 }, w.battle)).toBe(.6)
  })
  it('捕获网关闭推进器时不得绕过禁用，重建规格后恢复', () => {
    const w = player([], [speedId])
    w.battle.lastTickGameMs = 60000
    applyMeWebDebuff(w.spec, { byTag: 'foe-0', slowMul: .5, noThruster: true, noEvasion: true, rangeDownM: 0, atMs: 0 })
    expect(battleSpeedBonusOf(w.spec, w.battle)).toBe(0)
    expect(battleSpeedBonusOf(createPlayerSpec(w.state, ctx, w.uid)!, w.battle)).toBeCloseTo(.25)
  })
})

function combatWorld(count = 1, range = 2000, hit = 2) {
  const foe: FoeShipDef = { id: 'foe-acid-test', name: '测试靶', family: 'A', hullClassTier: 1, speedRatio: .001,
    hp: 1e8, split: { s: 0, a: 1, h: 0 }, shotDmg: 1, hitRate: 0, reloadMs: 60000,
    rangeMinM: 0, rangeMaxM: 10000, falloff: 1, dmgMix: { kinetic: 1 }, tactic: 'orbit', desireRangeM: range }
  const card = { ...anomaly('acid-test', 'galaxy-hub'), ships: [{ ship: foe }] }
  const testCtx = makeTestCtx({ quietEvents: true, ships: [ship('sandcat', { shieldHp: 1e8, armorHp: 1e8, hullHp: 1e8, maxSpeedMps: 100, cpu: 1000, slots: { high: 5, mid: 0, low: 5 } })],
    modules: [{ ...ctx.modules.get(acidId)!, hitRate: hit }, ctx.modules.get(speedId)!], anomalies: [card] })
  const state = createInitialState({ nowWallMs: 0, seed: 17 })
  state.fleet[state.shipId]!.fitted = { high: Array(count).fill(acidId), mid: [], low: [speedId] }
  const spec = createPlayerSpec(state, testCtx, state.shipId)!
  const battle = createBattleState(spec, createFoeSpecs(card, testCtx.balance.battle), 0, range)
  battle.distanceM = range
  battle.myDesireM = range
  battle.ammo.exp = 1000
  battle.units.player!.weapons = spec.weapons.map(w => w.acidOnHit ? 0 : 1e6)
  for (const rt of Object.values(battle.units)) delete rt.enteredAtMs
  return { state, spec, battle, ctx: testCtx, uid: state.shipId }
}

describe('真引擎命中与速度路径', () => {
  it('合并三门分别命中并叠三层，后门伤害吃前门破抗，射失零层', () => {
    const w = combatWorld(3)
    w.state.gameMs = 10
    advanceBattleFor(w.state, w.ctx, w.battle, w.uid, 'acid-test')
    expect(w.battle.foeAcidLayers!['foe-0']).toHaveLength(3)
    const shots = w.battle.fx.filter(f => f.side === 'me' && f.hit)
    expect(shots).toHaveLength(3)
    expect(shots[1]!.dmg).toBeGreaterThan(shots[0]!.dmg!)
    expect(shots[2]!.dmg).toBeGreaterThan(shots[1]!.dmg!)
    const miss = combatWorld(1, 2000, 0)
    miss.state.gameMs = 10
    advanceBattleFor(miss.state, miss.ctx, miss.battle, miss.uid, 'acid-test')
    expect(miss.battle.foeAcidLayers).toBeUndefined()
  })
  it('近盲仍命中且减伤、远程仍衰减与射程门生效', () => {
    const near = combatWorld(1, 1000), normal = combatWorld(1, 2000), beyond = combatWorld(1, 10001)
    for (const w of [near, normal, beyond]) {
      w.state.gameMs = 10
      advanceBattleFor(w.state, w.ctx, w.battle, w.uid, 'acid-test')
    }
    expect(near.battle.foeAcidLayers!['foe-0']).toHaveLength(1)
    expect(near.battle.stats.meDmg).toBeLessThan(normal.battle.stats.meDmg / 2)
    expect(beyond.battle.foeAcidLayers).toBeUndefined()
  })
  it('多来源层到期独立，真引擎读档续算与小步/大步等价', () => {
    const w = combatWorld()
    w.state.gameMs = 10
    advanceBattleFor(w.state, w.ctx, w.battle, w.uid, 'acid-test')
    addFoeAcidLayer(w.battle, 'foe-0', effect, 5000)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(w.battle)))!
    w.battle.units.player!.weapons = w.spec.weapons.map(() => 1e6)
    loaded.units.player!.weapons = [...w.battle.units.player!.weapons]
    const s2 = structuredClone(w.state)
    s2.gameMs = 16000
    advanceBattleFor(s2, w.ctx, loaded, w.uid, 'acid-test')
    for (let now = 20; now <= 16000; now += 10) {
      w.state.gameMs = now
      advanceBattleFor(w.state, w.ctx, w.battle, w.uid, 'acid-test')
    }
    expect(loaded.foeAcidLayers!['foe-0']).toEqual([{ cutPct: .1, untilMs: 20000 }])
    expect(w.battle.foeAcidLayers).toEqual(loaded.foeAcidLayers)
    expect(w.battle.units).toEqual(loaded.units)
    expect(w.battle.distanceM).toBeCloseTo(loaded.distanceM)
  })
  it('实战速度在点火窗口随时钟增长，冷却仍遵守既有周期', () => {
    const w = combatWorld()
    const advance = (now: number) => {
      w.battle.lastTickGameMs = now
      delete w.battle.speedAxis
      w.state.gameMs = now + 10
      advanceBattleFor(w.state, w.ctx, w.battle, w.uid, 'acid-test')
      return w.battle.meSpeedMps
    }
    const first = advance(0), mid = advance(30000)
    expect(mid).toBeGreaterThan(first!)
    const cooldown = advance(61000)
    expect(cooldown).toBeLessThan(first!)
    const full = advance(120000)
    expect(full).toBeGreaterThan(mid!)
    expect(battleArcsFor(w.state, w.ctx, { battle: w.battle, anomaly: w.ctx.anomalies.get('acid-test')!, leaderShipId: w.uid })).not.toBeNull()
  })
})
