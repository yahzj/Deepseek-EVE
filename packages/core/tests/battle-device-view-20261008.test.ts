import { describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import { battleDeviceCyclesOf } from '../src/battleDeviceView'
import type { BattleDeviceCycleView } from '../src/battleDeviceView'
import type { UnitSpec } from '../src/combat'
import type { BattleState, GameState } from '../src/state'
import type { FittedModules } from '../src/types'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { createPlayerSpec } from '../src/playerSpec'
import { advanceMyCaptureWebs, battleArcsFor, startBattleFor, startFleetBattleFor, thrusterPhase, unitThrusterCycle } from '../src/combat'
import { equipmentCycleMsOf } from '../src/equipment'
import { repairStatsFor, REPAIR_PULSE_MS, shieldChargeStreamsOf, shieldFieldStreamsOf } from '../src/combatRepair'
import { droneReviveCyclesOf, droneReviveNoteLoss } from '../src/droneRevive'

const ctx = buildSimContext()
type Unit = { spec: UnitSpec; shipId: string; name: string }
type World = { state: GameState; battle: BattleState; units: Unit[] }
const empty: FittedModules = { high: [], mid: [], low: [] }

function world(fittings: FittedModules[] = [empty]): World {
  const state = createInitialState({ nowWallMs: 0, seed: 1008 })
  const ids = fittings.map(fitted => {
    const id = addShipToFleet(state, 'sh-megalodon')
    state.fleet[id]!.fitted = structuredClone(fitted)
    state.fleet[id]!.droneLoad = { 'drone-scout': 2 }
    return id
  })
  state.shipId = ids[0]!
  state.warehouse.items['repairkit-mil'] = 20
  state.warehouse.items['repairkit-civ'] = 20
  state.warehouse.items['repairkit-dc'] = 2
  state.warehouse.items['drone-scout'] = 20
  const battle = startFleetBattleFor(state, ctx, ids, 'ano-training', 0)!
  const units = battle.myFleet!.map(({ shipId, tag }, index) => {
    const name = `测试舰${index + 1}`
    const spec = { ...createPlayerSpec(state, ctx, shipId)!, tag, name }
    return { spec, shipId, name }
  })
  return { state, battle, units }
}

function view(w: World): BattleDeviceCycleView[] {
  return battleDeviceCyclesOf(w.state, ctx, w.battle, w.units,
    spec => thrusterPhase(w.battle, ctx.balance.battle, unitThrusterCycle(spec, ctx.balance.battle)))
}

function rows(w: World, kind: BattleDeviceCycleView['kind'], tag = 'player'): BattleDeviceCycleView[] {
  return view(w).filter(row => row.kind === kind && row.ownerTag === tag)
}

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freezeDeep(child)
  Object.freeze(value)
}

describe('逐舰装置视图：真实账本和归属', () => {
  it('无装置及只有被动件时不生成计时条目', () => {
    expect(view(world())).toEqual([])
    expect(view(world([{ high: [], mid: ['mod-shield-kin-1'], low: [] }]))).toEqual([])
  })

  it('双舰维修逐台展开，充能和力场逐型号合并，并保留安装数量和归属', () => {
    const w = world([
      { high: ['mod-shieldfield-2', 'mod-shieldfield-2', 'mod-shieldfield-3'],
        mid: ['mod-hullrep-1', 'mod-hullrep-1', 'mod-shieldchg-1', 'mod-shieldchg-1', 'mod-shieldchg-3'], low: [] },
      { high: ['mod-shieldfield-3'], mid: ['mod-hullrep-2', 'mod-shieldchg-2'], low: [] },
    ])
    const all = view(w)
    expect(rows(w, 'repair')).toHaveLength(2)
    expect(rows(w, 'repair').map(row => row.count)).toEqual([1, 1])
    expect(rows(w, 'shield-charge').map(row => row.count)).toEqual([2, 1])
    expect(rows(w, 'shield-field').map(row => row.count)).toEqual([2, 1])
    expect(rows(w, 'repair', 'ally-1')).toHaveLength(1)
    expect(rows(w, 'shield-charge', 'ally-1')).toHaveLength(1)
    expect(rows(w, 'shield-field', 'ally-1')).toHaveLength(1)
    for (const row of all) {
      const owner = w.units.find(unit => unit.spec.tag === row.ownerTag)!
      expect(row.shipId).toBe(owner.shipId)
      expect(row.ownerName).toBe(owner.name)
    }
    expect(new Set(all.map(row => row.id)).size).toBe(all.length)
  })

  it('维修读逐台到点时刻和单点实际周期，不把同型号台数并成一条', () => {
    const w = world([{ high: [], mid: ['mod-hullrep-1', 'mod-hullrep-1'], low: [] }])
    const book = w.battle.repairBy!.player!
    book.units[0]!.nextPulseAtMs = 3_000
    book.units[1]!.nextPulseAtMs = 6_000
    w.battle.lastTickGameMs = 1_000
    const cycle = repairStatsFor(w.state, ctx, w.units[0]!.shipId)!.intervalMs
    expect(cycle).toBe(equipmentCycleMsOf(w.state, ctx, w.units[0]!.shipId, REPAIR_PULSE_MS))
    expect(rows(w, 'repair').map(row => row.remainingMs)).toEqual([2_000, 5_000])
    expect(rows(w, 'repair').map(row => row.cycleMs)).toEqual([cycle, cycle])
    expect(rows(w, 'repair')[0]!.percent).toBeCloseTo((1 - 2_000 / cycle) * 100)
  })

  it('旧维修账只在没有逐台计时字段时借统一时刻，读取不迁移', () => {
    const w = world([{ high: [], mid: ['mod-hullrep-1', 'mod-hullrep-2'], low: [] }])
    const book = w.battle.repairBy!.player!
    for (const unit of book.units) delete unit.nextPulseAtMs
    book.nextPulseAtMs = 3_000
    w.battle.lastTickGameMs = 1_000
    expect(rows(w, 'repair').map(row => row.remainingMs)).toEqual([2_000, 2_000])
    expect(book.units.every(unit => unit.nextPulseAtMs === undefined)).toBe(true)
    book.units[0]!.nextPulseAtMs = 4_000
    expect(rows(w, 'repair')[1]!.state).toBe('stopped')
  })

  it('单舰旧入口不丢主控维修与充能，不把它们分配给僚舰', () => {
    const w = world([{ high: [], mid: ['mod-hullrep-1', 'mod-shieldchg-1'], low: [] }, empty])
    w.battle.repair = w.battle.repairBy!.player
    w.battle.shieldCharge = w.battle.shieldChargeBy!.player
    delete w.battle.repairBy
    delete w.battle.shieldChargeBy
    expect(rows(w, 'repair')).toHaveLength(1)
    expect(rows(w, 'shield-charge')).toHaveLength(1)
    expect(view(w).every(row => row.ownerTag === 'player')).toBe(true)
  })

  it('充能与力场保持各流到点时刻，周期使用单点，效果只读本路账本', () => {
    const w = world([{ high: ['mod-shieldfield-2', 'mod-shieldfield-3'],
      mid: ['mod-shieldchg-1', 'mod-shieldchg-3'], low: ['mod-prop-2'] }])
    w.battle.lastTickGameMs = 2_000
    for (const kind of ['shield-charge', 'shield-field'] as const) {
      const current = (kind === 'shield-charge' ? shieldChargeStreamsOf : shieldFieldStreamsOf)(w.state, ctx, w.units[0]!.shipId)
      const streams = (kind === 'shield-charge' ? w.battle.shieldChargeBy : w.battle.shieldFieldBy)!.player!.streams
      streams[0]!.nextPulseAtMs = 6_000
      streams[1]!.nextPulseAtMs = 9_000
      const result = rows(w, kind)
      expect(result.map(row => row.remainingMs)).toEqual([4_000, 7_000])
      expect(result.map(row => row.cycleMs)).toEqual(current.map(stream => stream.ms))
      expect(result.map(row => row.effectPct)).toEqual(current.map(stream => stream.pct * 100))
      expect(result.map(row => row.percent)).toEqual(current.map((stream, i) => (1 - [4_000, 7_000][i]! / stream.ms) * 100))
    }
  })

  it('力场到点但无缺盾队友或无法支付时待机，能支付并有目标才就绪', () => {
    const w = world([{ high: ['mod-shieldfield-2'], mid: [], low: [] }, empty])
    w.battle.shieldFieldBy!.player!.streams[0]!.nextPulseAtMs = 0
    expect(rows(w, 'shield-field')[0]!.state).toBe('waiting')
    const ally = w.battle.units['ally-1']!
    ally.hp.s = 0
    expect(rows(w, 'shield-field')[0]!.state).toBe('ready')
    w.battle.units.player!.hp.s = 0
    expect(rows(w, 'shield-field')[0]).toMatchObject({ state: 'waiting', percent: 0 })
  })

  it('单舰入口的力场主控账与旧档空型号流只保留真实一路', () => {
    const w = world([{ high: ['mod-shieldfield-2', 'mod-shieldfield-3'], mid: [], low: [] }])
    w.battle = startBattleFor(w.state, ctx, w.units[0]!.shipId, 'ano-training', 0)!
    expect(rows(w, 'shield-field')).toHaveLength(2)
    const book = w.battle.shieldFieldBy!.player!
    book.streams = [{ modelId: '', pct: 0.29, ms: 99_000, nextPulseAtMs: 12_000 }]
    w.battle.lastTickGameMs = 3_000
    const minMs = Math.min(...shieldFieldStreamsOf(w.state, ctx, w.units[0]!.shipId).map(stream => stream.ms))
    expect(rows(w, 'shield-field')).toHaveLength(1)
    expect(rows(w, 'shield-field')[0]).toMatchObject({ count: 2, cycleMs: minMs, remainingMs: 9_000 })
    expect(rows(w, 'shield-field')[0]!.effectPct).toBeCloseTo(29)
    expect(book.streams[0]!.ms).toBe(99_000)
    expect(book.streams[0]!.nextPulseAtMs).toBe(12_000)
  })

  it('参数更新只读取现行周期，不重排在途截止时刻或修改账本效果', () => {
    const w = world([{ high: ['mod-shieldfield-2', 'mod-drone-deck-1'], mid: ['mod-shieldchg-1'], low: [] }])
    w.state.fleet[w.units[0]!.shipId]!.fitted.low.push('mod-wh-e-cpu')
    const at = w.battle.shieldFieldBy!.player!.streams[0]!.nextPulseAtMs!
    const oldMs = w.battle.shieldFieldBy!.player!.streams[0]!.ms
    w.battle.shieldFieldBy!.player!.streams[0]!.pct = 0.27
    const key = Object.keys(w.battle.dronePools!).find(key => key.startsWith('player:'))!
    w.battle.droneRevive!.player!.q.push(key)
    w.battle.droneRevive!.player!.t[0] = 7_000
    const deckCycle = w.battle.droneRevive!.player!.c[0]!
    const all = view(w)
    const field = all.find(row => row.kind === 'shield-field')!
    expect(field.cycleMs).toBe(shieldFieldStreamsOf(w.state, ctx, w.units[0]!.shipId)[0]!.ms)
    expect(field.cycleMs).toBeGreaterThan(oldMs)
    expect(field.remainingMs).toBe(at)
    expect(field.effectPct).toBeCloseTo(27)
    expect(w.battle.shieldFieldBy!.player!.streams[0]!.ms).toBe(oldMs)
    expect(w.battle.shieldFieldBy!.player!.streams[0]!.nextPulseAtMs).toBe(at)
    expect(all.find(row => row.kind === 'drone-deck')).toMatchObject({ cycleMs: deckCycle, remainingMs: 7_000 })
  })
})

describe('库存、下线和停止状态', () => {
  it('维修组件不足时显示缺料；货仓开关按各舰自身取库存', () => {
    const fitted = { high: [], mid: ['mod-hullrep-1'], low: [] }
    const w = world([fitted, fitted])
    w.state.resupplyFromWarehouse = false
    w.state.fleet[w.units[0]!.shipId]!.cargo['repairkit-mil'] = 1
    w.battle.lastTickGameMs = 10_000
    expect(rows(w, 'repair')[0]!.state).toBe('ready')
    expect(rows(w, 'repair', 'ally-1')[0]).toMatchObject({ state: 'no-stock', percent: 0 })
    w.state.resupplyFromWarehouse = true
    expect(rows(w, 'repair', 'ally-1')[0]!.state).toBe('ready')
    w.state.warehouse.items['repairkit-mil'] = 0
    expect(rows(w, 'repair')[0]!.state).toBe('no-stock')
  })

  it('旧账预载余额优先于现货，停机标记不能被现货抹去', () => {
    const w = world([{ high: [], mid: ['mod-hullrep-1'], low: [] }])
    w.battle.repairBy!.player!.kits = { 'repairkit-civ': 1, 'repairkit-mil': 0 }
    expect(rows(w, 'repair')[0]!.state).toBe('no-stock')
    w.battle.repairBy!.player!.units[0]!.stopped = true
    expect(rows(w, 'repair')[0]).toMatchObject({ state: 'stopped', percent: 0 })
  })

  it('无消耗自愈无需组件；有装置但缺调度账时不能就绪', () => {
    const freeId = [...ctx.modules.values()].find(mod => mod.repairFree && (mod.repairArmorHp ?? 0) > 0)!.id
    const w = world([{ high: [], mid: [freeId], low: [] }])
    w.state.warehouse.items = {}
    expect(rows(w, 'repair')[0]!.state).toBe('cooldown')
    delete w.battle.repairBy
    delete w.battle.repair
    expect(rows(w, 'repair')[0]).toMatchObject({ state: 'stopped', percent: 0 })
  })

  it('缺护盾流计时字段时显示停止，不凭开战时刻造周期', () => {
    const w = world([{ high: ['mod-shieldfield-2'], mid: ['mod-shieldchg-1'], low: [] }])
    delete w.battle.shieldChargeBy!.player!.streams[0]!.nextPulseAtMs
    delete w.battle.shieldFieldBy
    expect(rows(w, 'shield-charge')[0]).toMatchObject({ state: 'stopped', remainingMs: 0, percent: 0 })
    expect(rows(w, 'shield-field')[0]!.state).toBe('stopped')
  })

  it('舰船沉没、运行态缺失、战斗结束覆盖所有装置的就绪与活动状态', () => {
    const w = world([{ high: ['mod-lair-web-h', 'mod-drone-deck-1', 'mod-shieldfield-2'],
      mid: ['mod-hullrep-1', 'mod-shieldchg-1', 'mod-lair-blink-r', 'mod-stealth-3'], low: ['mod-prop-1', 'mod-dc-1'] }])
    expect(new Set(view(w).map(row => row.kind)).size).toBe(9)
    w.battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    expect(view(w).every(row => row.state === 'down' && row.percent === 0)).toBe(true)
    delete w.battle.units.player
    expect(view(w).every(row => row.state === 'down')).toBe(true)
    w.battle.units.player = { tag: 'player', side: 'me', name: '恢复夹具', hp: { s: 1, a: 1, h: 1 }, weapons: [] }
    w.battle.ended = 'me'
    expect(view(w).every(row => row.state === 'stopped' && row.percent === 0)).toBe(true)
  })
})

describe('捕获网与推进器单点', () => {
  it('只有僚舰有网时展示僚舰源、真实目标和账本减速，断网后读取真实冷却', () => {
    const w = world([empty, { high: ['mod-lair-web-h'], mid: [], low: [] }])
    const ally = w.units[1]!.spec
    const targetTag = Object.keys(w.battle.units).find(tag => tag.startsWith('foe'))!
    const target = { ...w.units[0]!.spec, tag: targetTag, name: '目标舰' }
    w.battle.distanceM = 2_000
    advanceMyCaptureWebs(w.state, w.battle, w.units.map(unit => unit.spec), [target])
    const debuff = w.battle.foeWebDebuffs![targetTag]!
    debuff.slowMul = 0.37
    expect(rows(w, 'web')).toEqual([])
    expect(rows(w, 'web', ally.tag)[0]).toMatchObject({ ownerTag: ally.tag, shipId: w.units[1]!.shipId,
      targetTag, targetName: w.battle.units[targetTag]!.name, state: 'active', remainingMs: 0, percent: 0, effectPct: 63 })
    w.battle.lastTickGameMs = 1_000
    w.battle.distanceM = ally.myCaptureWeb!.breakM + 1
    advanceMyCaptureWebs(w.state, w.battle, w.units.map(unit => unit.spec), [target])
    expect(rows(w, 'web', ally.tag)[0]).toMatchObject({ state: 'cooldown', remainingMs: ally.myCaptureWeb!.cycleMs })
    expect(rows(w, 'web', ally.tag)[0]!.targetTag).toBeUndefined()
  })

  it('网无目标、超距或已过冷却时待机；多件只展示一个合并机制', () => {
    const w = world([{ high: ['mod-lair-web-h', 'mod-lair-web-h'], mid: [], low: [] }])
    expect(rows(w, 'web')).toHaveLength(1)
    expect(rows(w, 'web')[0]).toMatchObject({ count: 2, state: 'waiting', percent: 0 })
    w.battle.myWebs = { player: { cooldownUntilMs: 8_000 } }
    w.battle.lastTickGameMs = 3_000
    expect(rows(w, 'web')[0]).toMatchObject({ state: 'cooldown', remainingMs: 5_000 })
    w.battle.lastTickGameMs = 8_000
    expect(rows(w, 'web')[0]!.state).toBe('waiting')
    w.battle.myWebs.player!.targetTag = '不存在的目标'
    expect(rows(w, 'web')[0]!.state).toBe('waiting')
  })

  it('推进器委托逐舰 phaseOf，合并数量但不复制相位算法', () => {
    const w = world([{ high: [], mid: [], low: ['mod-prop-1', 'mod-prop-2'] },
      { high: [], mid: [], low: ['mod-prop-3'] }])
    const phaseOf = vi.fn((spec: UnitSpec) => spec.tag === 'player'
      ? { boosting: true, remainMs: 17, cycleMs: 200, posMs: 73 }
      : { boosting: false, remainMs: 31, cycleMs: 400, posMs: 269 })
    const result = battleDeviceCyclesOf(w.state, ctx, w.battle, w.units, phaseOf)
    expect(phaseOf.mock.calls.map(([spec]) => spec.tag)).toEqual(['player', 'ally-1'])
    expect(result[0]).toMatchObject({ count: 2, state: 'active', cycleMs: 200, remainingMs: 17, percent: 36.5 })
    expect(result[1]).toMatchObject({ count: 1, state: 'cooldown', cycleMs: 400, remainingMs: 31, percent: 67.25 })
  })

  it('几丁质骨架和脉搏加速器不因速度加成被列为推进器', () => {
    const w = world([{ high: [], mid: [], low: ['mod-wh-c-frame', 'mod-wh-c-pulse'] }])
    expect(rows(w, 'thruster')).toEqual([])
    const mixed = world([{ high: [], mid: [], low: ['mod-wh-c-frame', 'mod-prop-2', 'mod-wh-c-pulse'] }])
    expect(rows(mixed, 'thruster')).toHaveLength(1)
    expect(rows(mixed, 'thruster')[0]).toMatchObject({ count: 1, label: ctx.modules.get('mod-prop-2')!.name })
  })

  it('推进器被网关闭时显示停止而非点火，非法相位不产生 NaN', () => {
    const w = world([{ high: [], mid: [], low: ['mod-prop-1'] }])
    w.battle.meWebDebuffs = { player: { byTag: 'foe', slowMul: 0.5, noThruster: true, noEvasion: true, rangeDownM: 0, atMs: 0 } }
    expect(rows(w, 'thruster')[0]).toMatchObject({ state: 'stopped', percent: 0 })
    const result = battleDeviceCyclesOf(w.state, ctx, w.battle, w.units,
      () => ({ boosting: true, remainMs: NaN, cycleMs: Infinity, posMs: NaN }))
    expect(result[0]).toMatchObject({ state: 'stopped', remainingMs: 0, cycleMs: 0, percent: 0 })
  })
})

describe('储备甲板、跃迁规避与一次性窗口', () => {
  it('储备甲板保持每件独立账本，下标按周期排序；损失启动真实 t/c 周期', () => {
    const w = world([{ high: ['mod-drone-deck-1', 'mod-drone-deck-3', 'mod-drone-deck-3'], mid: [], low: [] }])
    const cycles = droneReviveCyclesOf(w.state, ctx, w.units[0]!.shipId)
    expect(rows(w, 'drone-deck').map(row => row.cycleMs)).toEqual(cycles)
    expect(rows(w, 'drone-deck').map(row => row.label)).toEqual([
      ctx.modules.get('mod-drone-deck-3')!.name, ctx.modules.get('mod-drone-deck-3')!.name, ctx.modules.get('mod-drone-deck-1')!.name,
    ])
    expect(rows(w, 'drone-deck').every(row => row.state === 'waiting' && row.count === 1)).toBe(true)
    const key = Object.keys(w.battle.dronePools!).find(key => key.startsWith('player:'))!
    droneReviveNoteLoss(w.state, w.battle, key, 100)
    w.battle.lastTickGameMs = 1_000
    expect(rows(w, 'drone-deck')[0]).toMatchObject({ state: 'active', cycleMs: cycles[0], remainingMs: 100 + cycles[0]! - 1_000 })
    expect(rows(w, 'drone-deck')[1]!.state).toBe('waiting')
  })

  it('储备甲板只认共享预算快照，队头无库存但后续型号可补时仍运行', () => {
    const w = world([{ high: ['mod-drone-deck-1'], mid: [], low: [] }])
    const key = Object.keys(w.battle.dronePools!).find(key => key.startsWith('player:'))!
    const extraKey = 'player:99'
    w.battle.dronePools![extraKey] = { ...w.battle.dronePools![key]!, artId: 'drone-other' }
    w.battle.droneRevive!.player!.q = [extraKey, key]
    w.battle.droneRevive!.player!.t[0] = 4_000
    w.battle.droneReviveStock = { 'drone-scout': 1 }
    expect(rows(w, 'drone-deck')[0]!.state).toBe('active')
    w.battle.droneReviveStock = {}
    expect(w.state.warehouse.items['drone-scout']).toBeGreaterThan(0)
    expect(rows(w, 'drone-deck')[0]).toMatchObject({ state: 'no-stock', percent: 0 })
    delete w.battle.droneRevive
    expect(rows(w, 'drone-deck')[0]!.state).toBe('stopped')
  })

  it('跃迁规避多件仍只读一个 meBlink/meBlinks 冷却', () => {
    const w = world([{ high: [], mid: ['mod-lair-blink-r', 'mod-lair-blink-r'], low: [] }])
    const cycle = w.units[0]!.spec.meBlink!.cooldownMs
    expect(rows(w, 'blink')).toHaveLength(1)
    expect(rows(w, 'blink')[0]).toMatchObject({ count: 2, cycleMs: cycle, state: 'ready', percent: 100 })
    w.battle.meBlinks = { player: 10_000 }
    w.battle.lastTickGameMs = 5_000
    expect(rows(w, 'blink')[0]).toMatchObject({ state: 'cooldown', remainingMs: 5_000 })
    expect(rows(w, 'blink')[0]!.percent).toBeCloseTo((1 - 5_000 / cycle) * 100)
    w.battle.lastTickGameMs = 10_000
    expect(rows(w, 'blink')[0]!.state).toBe('ready')
  })

  it('隐身只显示实际窗口，不虚构循环；多件取现行最长件标签', () => {
    const w = world([{ high: ['mod-stealth-2', 'mod-stealth-3'], mid: [], low: [] }])
    const at = w.battle.units.player!.stealthUntilMs!
    w.battle.lastTickGameMs = 1_000
    expect(rows(w, 'stealth')[0]).toMatchObject({ label: ctx.modules.get('mod-stealth-3')!.name,
      count: 2, state: 'active', cycleMs: 0, remainingMs: at - 1_000, percent: 0 })
    delete w.battle.units.player!.stealthUntilMs
    expect(rows(w, 'stealth')[0]).toMatchObject({ state: 'used', cycleMs: 0, percent: 0 })
    const blocked = world([{ high: ['mod-stealth-3'], mid: [], low: ['mod-prop-1'] }])
    expect(rows(blocked, 'stealth')[0]!.state).toBe('stopped')
  })

  it('损管优先显示实际锁定窗口，再显示已用状态；未用时检查组件', () => {
    const w = world([{ high: [], mid: [], low: ['mod-dc-1', 'mod-dc-2'] }])
    expect(rows(w, 'damage-control')[0]).toMatchObject({ count: 2, state: 'ready', cycleMs: 0, percent: 100 })
    w.state.warehouse.items['repairkit-dc'] = 0
    expect(rows(w, 'damage-control')[0]).toMatchObject({ state: 'no-stock', percent: 0 })
    w.battle.lastTickGameMs = 700
    w.battle.dc = { player: { used: true, lockUntilMs: 1_000 } }
    expect(rows(w, 'damage-control')[0]).toMatchObject({ state: 'active', remainingMs: 300, cycleMs: 0, percent: 0 })
    w.battle.lastTickGameMs = 1_000
    expect(rows(w, 'damage-control')[0]!.state).toBe('used')
  })
})

describe('本地化与只读防御', () => {
  it('父入口接入后仍覆盖双舰装置、僚舰网、沉没与非循环窗口', () => {
    const w = world([{ high: ['mod-shieldfield-2', 'mod-stealth-3'], mid: ['mod-hullrep-1'], low: ['mod-dc-1'] },
      { high: ['mod-lair-web-h', 'mod-drone-deck-1'], mid: ['mod-lair-blink-r'], low: ['mod-prop-1'] }])
    const read = () => battleArcsFor(w.state, ctx, {
      battle: w.battle, leaderShipId: w.units[0]!.shipId, anomaly: ctx.anomalies.get('ano-training')!,
    })!
    const all = read().devices
    expect(all.filter(row => row.ownerTag === 'player')).toHaveLength(4)
    expect(all.filter(row => row.ownerTag === 'ally-1')).toHaveLength(4)
    expect(all.find(row => row.kind === 'web')).toMatchObject({ ownerTag: 'ally-1', state: 'waiting' })
    expect(all.find(row => row.kind === 'stealth')).toMatchObject({ cycleMs: 0, state: 'active' })
    const before = structuredClone(w)
    read()
    expect(w).toEqual(before)
    w.battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    expect(read().devices.filter(row => row.ownerTag === 'ally-1').every(row => row.state === 'down' && row.percent === 0)).toBe(true)
  })

  it('标签读取 ctx.modules 的现行本地化名称', () => {
    const w = world([{ high: ['mod-lair-web-h', 'mod-drone-deck-1', 'mod-shieldfield-2', 'mod-stealth-3'],
      mid: ['mod-hullrep-1', 'mod-shieldchg-1', 'mod-lair-blink-r'], low: ['mod-prop-1', 'mod-dc-1'] }])
    const local = { ...ctx, modules: new Map([...ctx.modules].map(([id, mod]) => [id, { ...mod, name: `Localized:${id}` }])) }
    const all = battleDeviceCyclesOf(w.state, local, w.battle, w.units,
      spec => thrusterPhase(w.battle, local.balance.battle, unitThrusterCycle(spec, local.balance.battle)))
    expect(all).toHaveLength(9)
    expect(all.every(row => row.label.startsWith('Localized:'))).toBe(true)
  })

  it('冻结状态、战斗与输入后反复读取不改库存、账本、单位或装配；返回值不共享引用', () => {
    const w = world([{ high: ['mod-lair-web-h', 'mod-drone-deck-1', 'mod-shieldfield-2', 'mod-stealth-3'],
      mid: ['mod-hullrep-1', 'mod-shieldchg-1', 'mod-lair-blink-r'], low: ['mod-prop-1', 'mod-dc-1'] },
    { high: ['mod-lair-web-h', 'mod-drone-deck-3'], mid: ['mod-hullrep-2'], low: [] }])
    const before = structuredClone(w)
    freezeDeep(w)
    const first = view(w)
    expect(view(w)).toEqual(first)
    first[0]!.label = '修改返回值'
    expect(view(w)[0]!.label).not.toBe('修改返回值')
    expect(w).toEqual(before)
  })

  it('虫洞缺物资账不补字段、不借仓库；维修与损管都显示缺料', () => {
    const w = world([{ high: [], mid: ['mod-hullrep-1'], low: ['mod-dc-1'] }])
    w.battle.wormhole = {} as NonNullable<BattleState['wormhole']>
    w.state.wormhole.run = { supplyVersion: 1, expeditionRules: 1, fleet: [w.units[0]!.shipId] } as unknown as NonNullable<GameState['wormhole']['run']>
    const before = structuredClone(w)
    freezeDeep(w)
    expect(view(w).every(row => row.state === 'no-stock' && row.percent === 0)).toBe(true)
    expect(w).toEqual(before)
    expect(w.state.wormhole.run!.supplies).toBeUndefined()
  })

  it('虫洞现有物资账优先于仓库和货仓，损管不会借维修预载组件', () => {
    const w = world([{ high: [], mid: ['mod-hullrep-1'], low: ['mod-dc-1'] }])
    w.battle.wormhole = {} as NonNullable<BattleState['wormhole']>
    w.state.wormhole.run = { supplyVersion: 1, fleet: [w.units[0]!.shipId], supplies: {
      items: { 'repairkit-mil': 1 }, carried: {}, consumed: {}, deployed: {}, recovered: {}, leftBehind: {}, found: {},
    } } as unknown as NonNullable<GameState['wormhole']['run']>
    expect(rows(w, 'repair')[0]!.state).toBe('cooldown')
    expect(rows(w, 'damage-control')[0]!.state).toBe('no-stock')
    w.state.wormhole.run!.supplies!.items = { 'repairkit-dc': 1 }
    expect(rows(w, 'repair')[0]!.state).toBe('no-stock')
    expect(rows(w, 'damage-control')[0]!.state).toBe('ready')
    w.battle.repairBy!.player!.kits = { 'repairkit-mil': 1 }
    expect(rows(w, 'repair')[0]!.state).toBe('cooldown')
  })

  it('坏旧档的空流、无穷计时、缺槽和缺舰记录不崩溃、不伪装就绪', () => {
    const w = world([{ high: ['mod-shieldfield-2', 'mod-drone-deck-1'], mid: ['mod-hullrep-1'], low: [] }])
    w.battle.repairBy!.player!.units[0]!.nextPulseAtMs = NaN
    w.battle.shieldFieldBy!.player!.streams[0]!.nextPulseAtMs = Infinity
    w.battle.droneRevive!.player!.c[0] = NaN
    expect(view(w).every(row => row.state === 'stopped')).toBe(true)
    w.battle.shieldFieldBy!.player!.streams = undefined as never
    w.battle.droneRevive!.player!.q = undefined as never
    w.state.fleet[w.units[0]!.shipId]!.fitted.mid = undefined as never
    expect(() => view(w)).not.toThrow()
    delete w.state.fleet[w.units[0]!.shipId]
    expect(() => view(w)).not.toThrow()
    for (const row of view(w)) {
      expect(Number.isFinite(row.cycleMs)).toBe(true)
      expect(Number.isFinite(row.remainingMs)).toBe(true)
      expect(Number.isFinite(row.percent)).toBe(true)
    }
  })

  it('坏闪现冷却不显示就绪，储备甲板只识别引擎读取的高槽', () => {
    const w = world([{ high: [], mid: ['mod-lair-blink-r', 'mod-drone-deck-1'], low: [] }])
    expect(rows(w, 'drone-deck')).toEqual([])
    w.battle.meBlinks = { player: Infinity }
    expect(rows(w, 'blink')[0]).toMatchObject({ state: 'stopped', remainingMs: 0, percent: 0 })
    w.battle.meBlinks.player = NaN
    expect(rows(w, 'blink')[0]!.state).toBe('stopped')
  })
})
