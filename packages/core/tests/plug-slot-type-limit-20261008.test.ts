import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'
import { buildSimContext, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { repairDeprecatedModules, cpuBudgetOf } from '../src/equipment'
import { installPlug, normalizePlugSlotExpansions, plugSlotExpansionBlockedOf, plugSlotExpansionKindOf, shipSlotsWithPlugsOf } from '../src/plugs'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceGame } from '../src/engine'
import { noteShipWreck } from '../src/shipWrecks'
import { pullOneWreck } from '../src/salvaging'
import { retireMiningShip } from '../src/mining'
import { ROOT } from './helpers/save-shell'

const ctx = buildSimContext()
function oldFleet() {
  const state = createInitialState({ nowWallMs: 0, seed: 13, prologue: true })
  const uid = addShipToFleet(state, 'sh-wh-a-frigate')
  const ship = state.fleet[uid]!
  ship.plugs = ['plug-mid-bay', 'plug-cpu-core', 'plug-mid-bay', 'plug-low-bay', 'plug-low-bay', 'plug-cpu-core']
  const slots = shipSlotsWithPlugsOf(state, ctx, uid)
  ship.fitted = { high: Array(slots.high).fill(null), mid: Array(slots.mid).fill(null), low: Array(slots.low).fill(null) }
  ship.fitted.mid[slots.mid - 1] = 'mod-shield-kin-1'
  ship.fitted.low[slots.low - 1] = 'mod-drone-rack-2'
  ship.droneLoad = { 'drone-scout': 6 }
  ship.durability = 0.61
  ship.armorPct = 0.72
  return { state, uid, ship }
}

describe('扩槽同类型限一件与资产完整退回', () => {
  it('中、低类型各一件且普通重复插件不受影响，拒绝动作不扣钱和库存', () => {
    const { state, uid, ship } = oldFleet()
    ship.plugs = []
    for (const id of ['plug-mid-bay', 'plug-low-bay', 'plug-cpu-core']) state.moduleBay[id] = 3
    for (const id of ['plug-mid-bay', 'plug-low-bay', 'plug-cpu-core', 'plug-cpu-core']) expect(installPlug(state, ctx, id, uid).ok).toBe(true)
    for (const id of ['plug-mid-bay', 'plug-low-bay']) {
      const before = structuredClone(state)
      expect(installPlug(state, ctx, id, uid)).toMatchObject({ ok: false, errorId: 'core.plug.014' })
      expect(state).toEqual(before)
    }
    expect(ship.plugs).toEqual(['plug-mid-bay', 'plug-low-bay', 'plug-cpu-core', 'plug-cpu-core'])
    expect(plugSlotExpansionKindOf(ctx.modules.get('plug-mid-bay'))).toBe('mid')
    expect(plugSlotExpansionKindOf(ctx.modules.get('plug-low-bay'))).toBe('low')
    expect(plugSlotExpansionKindOf(ctx.modules.get('plug-cpu-core'))).toBeNull()
    expect(plugSlotExpansionKindOf({ slot: 'support', midSlotsAdd: 1 })).toBeNull()
  })

  it('相同扩槽类型的不同型号也拦截，不按名称或id前缀判断', () => {
    const { state, uid, ship } = oldFleet()
    ship.plugs = ['plug-mid-bay']
    const alias = { ...ctx.modules.get('plug-mid-bay')!, id: 'other-model', name: '另型扩槽' }
    const local = { ...ctx, modules: new Map(ctx.modules).set(alias.id, alias) }
    state.moduleBay[alias.id] = 2
    expect(plugSlotExpansionBlockedOf(state, local, uid, alias)).toBe(true)
    expect(installPlug(state, local, alias.id, uid).ok).toBe(false)
    ship.plugs.push(alias.id)
    expect(normalizePlugSlotExpansions(state, local)).toEqual([uid])
    expect(state.moduleBay[alias.id]).toBe(3)
    expect(ship.plugs).toEqual(['plug-mid-bay'])
  })

  it('真实读档修复保留首件、免费返插件和超槽模块，并将失去机舱的无人机完整退库', () => {
    const { state, uid } = oldFleet()
    const before = structuredClone({ wallet: state.wallet, rng: state.rng })
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    repairDeprecatedModules(back, ctx)
    expect(back.fleet[uid]!.plugs).toEqual(['plug-mid-bay', 'plug-cpu-core', 'plug-low-bay', 'plug-cpu-core'])
    for (const id of ['plug-mid-bay', 'plug-low-bay', 'mod-shield-kin-1', 'mod-drone-rack-2']) expect(back.moduleBay[id]).toBe(1)
    expect(back.warehouse.items['drone-scout']).toBe(4)
    expect(back.fleet[uid]!.droneLoad).toEqual({ 'drone-scout': 2 })
    expect(back.warehouse.items['drone-scout']! + back.fleet[uid]!.droneLoad!['drone-scout']!).toBe(6)
    expect(back.fleet[uid]!.fitted.mid).toHaveLength(5)
    expect(back.fleet[uid]!.fitted.low).toHaveLength(2)
    expect([back.fleet[uid]!.durability, back.fleet[uid]!.armorPct]).toEqual([0.61, 0.72])
    expect(back.wallet).toEqual(before.wallet)
    expect(back.rng).toEqual(before.rng)
    expect(cpuBudgetOf(back, ctx, uid)).toBe(cpuBudgetOf(state, ctx, uid))
    expect(back.logs.filter(row => row.textId === 'core.plug.015')).toHaveLength(1)
    const cleaned = structuredClone(back)
    repairDeprecatedModules(back, ctx)
    expect(back).toEqual(cleaned)
    const next = loadSaveFile(serializeSaveFile(back)).state
    repairDeprecatedModules(next, ctx)
    expect(next.moduleBay).toEqual(back.moduleBay)
    expect(next.warehouse).toEqual(back.warehouse)
    expect(next.logs.filter(row => row.textId === 'core.plug.015')).toHaveLength(1)
  })

  it('未运行修复的loadSaveFile仅清结构不返物品；一次心跳完成免费整理且不重复发放', () => {
    const { state, uid } = oldFleet()
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back.fleet[uid]!.plugs).toHaveLength(6)
    expect(back.moduleBay['plug-mid-bay']).toBeUndefined()
    advanceGame(back, 1, ctx, { offline: true })
    expect(back.fleet[uid]!.plugs).toHaveLength(4)
    const count = { ...back.moduleBay }
    advanceGame(back, 1, ctx, { offline: true })
    expect(back.moduleBay).toEqual(count)
  })

  it('在洞、自动队、战斗和AI作业配置不被中途裁掉，解锁后下一拍整理', () => {
    const { state, uid, ship } = oldFleet()
    const original = structuredClone(ship)
    state.wormhole.run = { fleet: [uid] } as never
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([])
    state.wormhole.run = null
    state.wormholeAuto = [{ shipIds: [uid] }] as never
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([])
    state.wormholeAuto = []
    state.expedition.active = true
    state.expedition.battle = { myFleet: [{ shipId: uid }] } as never
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([])
    state.expedition.battle = null
    state.expedition.active = false
    state.aiAssignments[uid] = { shipId: uid } as never
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([])
    delete state.aiAssignments[uid]
    expect(ship).toEqual(original)
    advanceGame(state, 1, ctx, { offline: true })
    expect(ship.plugs).toHaveLength(4)
    expect(state.moduleBay['plug-mid-bay']).toBe(1)
  })

  it('旧普通槽误装插件归位不能绕过限装，重复件直接退库', () => {
    const { state, ship } = oldFleet()
    ship.plugs = ['plug-mid-bay']
    ship.fitted = { high: [null], mid: ['plug-mid-bay'], low: ['plug-low-bay'] }
    repairDeprecatedModules(state, ctx)
    expect(ship.plugs).toEqual(['plug-mid-bay', 'plug-low-bay'])
    expect(state.moduleBay['plug-mid-bay']).toBe(1)
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([])
  })

  it.each(['mining', 'salvaging'] as const)('主控%s作业中不拆扩槽件，不裁装备或退无人机', activity => {
    const { state, uid, ship } = oldFleet()
    state.shipId = uid
    state[activity].active = true
    const original = structuredClone(state)
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([])
    expect(state).toEqual(original)
    state[activity].active = false
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([uid])
    expect(ship.plugs).toHaveLength(4)
  })

  it('真实停采返航中保存重载仍保留配置，到港同一拍免费整理，货物与机体守恒', () => {
    const { state, uid, ship } = oldFleet()
    const belt = [...ctx.belts.values()][0]!
    state.shipId = uid
    state.mining.active = true
    state.mining.beltId = belt.id
    ship.cargo[belt.oreId] = 1
    expect(retireMiningShip(state, ctx, { fallbackLegMs: 1000 })).toBe(true)
    expect(state.shipReturns[uid]!.legMs).toBe(1000)
    const plugs = [...ship.plugs!]
    advanceGame(state, 500, ctx, { offline: true })
    expect(ship.plugs).toEqual(plugs)
    expect(state.shipReturns[uid]!.phaseAccMs).toBe(500)
    const back = loadSaveFile(serializeSaveFile(state)).state
    repairDeprecatedModules(back, ctx)
    expect(back.fleet[uid]!.plugs).toEqual(plugs)
    expect(back.moduleBay['plug-mid-bay']).toBeUndefined()
    advanceGame(back, 500, ctx, { offline: true })
    expect(back.shipReturns[uid]).toBeUndefined()
    expect(back.fleet[uid]!.plugs).toEqual(['plug-mid-bay', 'plug-cpu-core', 'plug-low-bay', 'plug-cpu-core'])
    expect(back.moduleBay['plug-mid-bay']).toBe(1)
    expect(back.moduleBay['plug-low-bay']).toBe(1)
    expect(back.moduleBay['mod-shield-kin-1']).toBe(1)
    expect(back.moduleBay['mod-drone-rack-2']).toBe(1)
    expect(back.fleet[uid]!.cargo).toEqual({})
    expect(back.warehouse.items[belt.oreId]).toBe(1)
    expect(back.warehouse.items['drone-scout']! + back.fleet[uid]!.droneLoad!['drone-scout']!).toBe(6)
    const stock = structuredClone({ modules: back.moduleBay, warehouse: back.warehouse })
    advanceGame(back, 500, ctx, { offline: true })
    expect({ modules: back.moduleBay, warehouse: back.warehouse }).toEqual(stock)
    expect(back.logs.filter(row => row.textId === 'core.plug.015')).toHaveLength(1)
  })

  it('同型多个舰船独立整理，未知插件/战损/历史记录/方案保留，不凭历史记录返物品', () => {
    const { state, uid, ship } = oldFleet()
    const second = addShipToFleet(state, 'sh-wh-a-frigate')
    state.fleet[second]!.plugs = ['plug-low-bay', 'plug-low-bay']
    ship.plugs!.push('unknown-plug')
    ship.damagePlugs = ['range']
    state.fitPresets = { 'sh-wh-a-frigate': [{ name: '历史', fitted: structuredClone(ship.fitted), plugs: [...ship.plugs!] }] }
    const history = structuredClone(state.fitPresets)
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([uid, second])
    expect(state.moduleBay['plug-mid-bay']).toBe(1)
    expect(state.moduleBay['plug-low-bay']).toBe(2)
    expect(ship.plugs).toContain('unknown-plug')
    expect(ship.damagePlugs).toEqual(['range'])
    expect(state.fitPresets).toEqual(history)
  })

  it('成功打捞旧重复扩槽的舰船时仅保留各类一件，原位保全装备超位就退库', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 13, prologue: true })
    state.skills.trained['wreck-equipment-preservation'] = 5
    const record = noteShipWreck(state, { galaxyId: 'galaxy-hub', shipId: 'lost', shipName: '旧舰', defId: 'sh-wh-a-frigate',
      fitted: { high: [], mid: [null, null, null, null, null, 'mod-shield-kin-1'], low: [] },
      plugs: ['plug-mid-bay', 'plug-mid-bay', 'plug-low-bay', 'plug-low-bay'] })
    record.reinforceChance = 1
    state.wreckLog = [{ seq: 1, shipId: 'lost', shipName: '旧舰', defId: 'sh-wh-a-frigate', cause: 'expedition-lost', atGameMs: 0,
      plugs: [...record.plugs!] }]
    const history = structuredClone(state.wreckLog!)
    pullOneWreck(state, ctx, 'galaxy-hub', 1000)
    const recovered = Object.values(state.fleet).find(s => s.defId === 'sh-wh-a-frigate')!
    expect(recovered).toBeDefined()
    expect(recovered.plugs).toEqual(['plug-mid-bay', 'plug-low-bay'])
    expect(state.moduleBay['plug-mid-bay']).toBe(1)
    expect(state.moduleBay['plug-low-bay']).toBe(1)
    expect(state.moduleBay['mod-shield-kin-1']).toBe(1)
    expect(state.wreckLog![0]!.plugs).toEqual(history[0]!.plugs)
  })

  it('真实装配候选只过滤已经拥有的扩槽类型，不过滤另一路和普通同型', () => {
    const { state, uid, ship } = oldFleet()
    ship.plugs = ['plug-mid-bay', 'plug-cpu-core']
    for (const id of ['plug-mid-bay', 'plug-low-bay', 'plug-cpu-core']) state.moduleBay[id] = 1
    const source = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/pages/FitPage.tsx'), 'utf8')
    const ast = ts.createSourceFile('fit.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let expression: string | undefined
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'pickable') expression = node.initializer!.getText(ast)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(expression).toBeDefined()
    const result = runInNewContext(expression!, { state, ctx, target: uid, plugSlotExpansionBlockedOf }) as Array<{ id: string }>
    expect(result.map(row => row.id)).toEqual(['plug-low-bay', 'plug-cpu-core'])
  })

  it('拒绝安装与整理日志分开，中英模板都准确且无槽内中文', () => {
    expect(L10N['core.plug.014']!.zh).toBe('同类型扩槽插件每舰只能安装一件。')
    expect(L10N['core.plug.014']!.en).not.toContain('returned')
    const { state } = oldFleet()
    normalizePlugSlotExpansions(state, ctx)
    const log = state.logs.find(row => row.textId === 'core.plug.015')!
    expect(log.text).toBe(L10N[log.textId!]!.zh.replace('{p1}', String(log.textParams!.p1)))
  })
})
