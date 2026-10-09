import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { createPlayerSpec, createBattleState, beamPowerFactor, beamPowerVsTargetOf } from '../src/combat'
import { fitModule, weightedGap, weightedSum, droneCpuUsed, stackWeight, stackingOf, laserFalloffOf } from '../src/equipment'
import { initDroneLaunch, releaseDroneLaunch, requeueDroneLaunch, droneLaunchGapMsOf } from '../src/droneLaunch'
import { buildDronePoolsFor } from '../src/combatDrones'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { cleanBattle } from '../src/saveBattleClean'
import { fittedEffectParamsOf } from '../src/foeRange'
import { moduleAllowedOnShip } from '../src/shipFitting'
import { learnBlueprint } from '../src/market'
import { startManufacturing, advanceManufacturing } from '../src/manufacturing'
import { deferredL10nIssues } from '../../../tools/l10n-deferred-check'
import ships from '../../data/src/static/ships.json'
import modules from '../../data/src/static/modules.json'

const ctx = buildSimContext(), root = new URL('../../../', import.meta.url)
const cases = [
  { id: 'mod-drone-launch-1', cut: .3, cpu: 8, price: 18000, book: 36000, source: 'bp-drone-tac-1' },
  { id: 'mod-drone-launch-2', cut: .35, cpu: 20, price: 455000, book: 1137500, source: 'bp-drone-tac-2' },
  { id: 'mod-drone-launch-3', cut: .4, cpu: 45, price: 2040000, book: 8160000, source: 'bp-drone-tac-3' },
  { id: 'mod-laser-calibration-2', cut: .1, cpu: 15, price: 481000, book: 1202500, source: 'bp-stab-pla-2' },
  { id: 'mod-laser-calibration-3', cut: .13, cpu: 40, price: 2360000, book: 9440000, source: 'bp-stab-pla-3' },
] as const
function world(ship = 'sh-megalodon', high: string[] = [], low: string[] = []) {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const uid = addShipToFleet(state, ship)
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  for (const id of [...high, ...low]) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    expect(fitModule(state, id, ctx, { shipId: uid }).ok, id).toBe(true)
  }
  state.fleet[uid]!.droneLoad = { 'drone-scout': 3 }
  return { state, uid, spec: createPlayerSpec(state, ctx, uid)! }
}
function queue() {
  const w = world('sh-wh-e-carrier', ['mod-drone-launch-3'])
  const b = createBattleState(w.spec, [{ ...w.spec, tag: 'foe-0', side: 'foe' }], 0, 1000)
  b.distanceM = 1000
  b.dronePools = {}
  buildDronePoolsFor(ctx, w.spec, b.dronePools, 1, 1)
  initDroneLaunch(b, [w.spec])
  const indices = w.spec.weapons.flatMap((weapon, i) => weapon.src === 'drone' ? [i] : [])
  return { ...w, b, indices }
}

describe('出击加速、激光校准与协处理器5%', () => {
  it.each(cases)('$id数据/配方/价格/永久学习和实际制造同源', row => {
    const mod = ctx.modules.get(row.id)!, bpId = row.id.replace(/^mod-/, 'bp-'), bp = ctx.blueprints.get(bpId)!
    const ref = ctx.blueprints.get(row.source)!
    expect(mod.cpuUse).toBe(row.cpu)
    expect(mod.droneLaunchCutPct ?? mod.laserFalloffBonus).toBe(row.cut)
    expect(mod.rack).toBe(row.id.startsWith('mod-drone') ? 'high' : 'low')
    expect(ctx.marketGoods.get(row.id)!.basePrice).toBe(row.price)
    expect(ctx.marketGoods.get(bpId)!.basePrice).toBe(row.book)
    expect(bp.materials).toEqual(ref.materials)
    expect(bp.buildSeconds).toBe(ref.buildSeconds)
    expect(bp.singleUse).not.toBe(true)
    if (row.id.endsWith('-3')) {
      expect(ctx.marketGoods.get(row.id)!.rarity).toBe('exotic')
      expect(ctx.marketGoods.get(bpId)!.rarity).toBe('exotic')
      expect(ctx.marketGoods.get(row.id)!.bmStanding).toBeUndefined()
      expect(ctx.marketGoods.get(bpId)!.bmStanding).toBeUndefined()
      expect(ctx.marketGoods.get(bpId)!.standingReq).toBe(4)
    }
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    state.blueprintStock[bpId] = 1
    expect(learnBlueprint(state, ctx, bpId).ok).toBe(true)
    for (const need of bp.materials) state.warehouse.items[need.itemId] = need.count
    expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(true)
    state.gameMs = state.manufacturingRuns.find(run => run.active && run.blueprintId === bpId)!.finishAtGameMs
    advanceManufacturing(state, ctx)
    expect(state.moduleBay[row.id]).toBe(1)
  })

  it('新首发三档混装强到弱递减乘算，旧机库独立，船体独立，下限10ms', () => {
    const defs = cases.slice(0, 3).map(row => ctx.modules.get(row.id)!)
    const h = ctx.modules.get('mod-wh-a-hangar')!
    const expected = Math.round(500 * (1 - weightedGap([.3, .35, .4])))
    expect(droneLaunchGapMsOf(defs)).toBe(expected)
    expect(droneLaunchGapMsOf([...defs].reverse())).toBe(expected)
    expect(droneLaunchGapMsOf([h, h, ...defs], .3)).toBe(Math.round(500 * .8 ** 2 * .7 * (1 - weightedGap([.3, .35, .4]))))
    expect(droneLaunchGapMsOf([h, h, ...defs], .3, true)).toBe(320)
    expect(droneLaunchGapMsOf(Array(30).fill(h), .3)).toBe(10)
  })

  it('仅巨构航母固有30%，首次500→350；装备叠乘，不改变攻击装填/伤害', () => {
    const base = world('sh-wh-e-carrier'), after = world('sh-wh-e-carrier', ['mod-drone-launch-3'])
    expect(base.spec.droneLaunchGapMs).toBe(350)
    expect(after.spec.droneLaunchGapMs).toBe(210)
    expect(after.spec.droneReviveGapMs).toBe(500)
    expect(after.spec.weapons.filter(w => w.src === 'drone')).toEqual(base.spec.weapons.filter(w => w.src === 'drone'))
    for (const ship of ctx.ships.values()) if (ship.id !== 'sh-wh-e-carrier') expect(ship.droneLaunchCutPct).toBeUndefined()
    expect(world('sh-wh-e-destroyer').spec.droneLaunchGapMs).toBe(500)
  })

  it('首次/复活混合队列使用各自间隔，重复重排不延长余额，保存往返保持', () => {
    const { state, spec, b, indices } = queue()
    expect(b.droneLaunchBy!.player).toMatchObject({ gapMs: 210, reviveGapMs: 500 })
    expect(releaseDroneLaunch(b, spec, indices[0]!)).toBe(true)
    b.lastTickGameMs = 209
    expect(releaseDroneLaunch(b, spec, indices[1]!)).toBe(false)
    b.lastTickGameMs = 210
    expect(releaseDroneLaunch(b, spec, indices[1]!)).toBe(true)
    const key = `player:${indices[0]}`
    requeueDroneLaunch(b, key)
    b.lastTickGameMs = 420
    expect(releaseDroneLaunch(b, spec, indices[2]!)).toBe(true)
    expect(b.droneLaunchBy!.player!.nextAtMs).toBe(920)
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: b }
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle!
    expect(loaded.droneLaunchBy).toEqual(b.droneLaunchBy)
    expect(loaded.dronePools![key]!.launchRequeued).toBe(true)
    loaded.lastTickGameMs = 919
    expect(releaseDroneLaunch(loaded, spec, indices[0]!)).toBe(false)
    loaded.lastTickGameMs = 920
    expect(releaseDroneLaunch(loaded, spec, indices[0]!)).toBe(true)
    requeueDroneLaunch(loaded, key)
    const at = loaded.droneLaunchBy!.player!.nextAtMs
    requeueDroneLaunch(loaded, key)
    expect(loaded.droneLaunchBy!.player!.nextAtMs).toBe(at)
    expect(at).toBe(1420)
  })

  it('旧档缺新字段时原gap与截止保持，坏复活字段被清洗', () => {
    const { b } = queue()
    delete b.droneLaunchBy!.player!.reviveGapMs
    b.droneLaunchBy!.player!.gapMs = 400
    b.droneLaunchBy!.player!.nextAtMs = 137
    expect(cleanBattle(b)!.droneLaunchBy!.player).toEqual(b.droneLaunchBy!.player)
    const bad = structuredClone(b) as unknown as { droneLaunchBy: { player: { reviveGapMs: unknown } } }
    bad.droneLaunchBy.player.reviveGapMs = '500'
    expect(cleanBattle(bad)!.droneLaunchBy!.player!.reviveGapMs).toBeUndefined()
  })

  it('未出击队头失效后，复活机仍等待完整旧间隔，不借首发加速提前放飞', () => {
    const { b, spec, indices } = queue()
    expect(releaseDroneLaunch(b, spec, indices[0]!)).toBe(true)
    const revived = `player:${indices[0]}`
    requeueDroneLaunch(b, revived)
    b.dronePools![`player:${indices[1]}`]!.alive = false
    b.dronePools![`player:${indices[2]}`]!.alive = false
    b.lastTickGameMs = 210
    expect(releaseDroneLaunch(b, spec, indices[0]!)).toBe(false)
    expect(b.droneLaunchBy!.player!.nextAtMs).toBe(500)
    b.lastTickGameMs = 500
    expect(releaseDroneLaunch(b, spec, indices[0]!)).toBe(true)
  })

  it('缺队列的旧战斗复活时不套新增航母特性，仍按旧等待重建', () => {
    const { b, spec, indices } = queue()
    delete b.droneLaunchBy
    for (const pool of Object.values(b.dronePools!)) delete pool.launched
    const key = `player:${indices[0]}`
    expect(releaseDroneLaunch(b, spec, indices[0]!)).toBe(true)
    requeueDroneLaunch(b, key)
    expect(releaseDroneLaunch(b, spec, indices[0]!)).toBe(true)
    expect(b.droneLaunchBy!.player!.gapMs).toBe(500)
    expect(b.droneLaunchBy!.player!.nextAtMs).toBe(500)
  })

  it('激光两档折权加算仅改falloff，上限1，所有其他武器/射程/单发保持', () => {
    const high = ['mod-laser-3', 'mod-turret-kin-3', 'mod-missile-3']
    const before = world('sh-megalodon', high), after = world('sh-megalodon', high, ['mod-laser-calibration-2', 'mod-laser-calibration-3'])
    const bonus = weightedSum([.1, .13])
    const beam = after.spec.weapons.find(w => w.src === 'laser')!, oldBeam = before.spec.weapons.find(w => w.src === 'laser')!
    expect(beam.falloff).toBeCloseTo(oldBeam.falloff + bonus)
    expect({ ...beam, falloff: oldBeam.falloff }).toEqual(oldBeam)
    expect(after.spec.weapons.filter(w => w.src !== 'laser')).toEqual(before.spec.weapons.filter(w => w.src !== 'laser'))
    expect(beamPowerFactor(beam.maxRangeM, beam)).toBeCloseTo(beam.falloff)
    expect(beamPowerFactor(beam.minRangeM, beam)).toBe(1)
    expect(beamPowerVsTargetOf(beam.maxRangeM, beam, true)).toBe(1)
    expect(laserFalloffOf(.99, [ctx.modules.get('mod-laser-calibration-3')!])).toBe(1)
  })

  it('多装有效值与实际强度排序一致，滤镜/货舰禁用和分类齐备', () => {
    const w = world('sh-megalodon', ['mod-drone-launch-1', 'mod-drone-launch-3'], ['mod-laser-calibration-2', 'mod-laser-calibration-3'])
    for (const row of [cases[0]!, cases[3]!]) {
      const mod = ctx.modules.get(row.id)!
      expect(fittedEffectParamsOf(w.state, ctx, w.uid, mod, 1)[0]!.eff).toBeCloseTo(row.cut * stackWeight(2))
      expect(stackingOf(mod).group).not.toBe('flat')
      expect(moduleAllowedOnShip(ctx.ships.get('sh-flyingfish'), mod)).toBe(false)
    }
    const subs = readFileSync(new URL('apps/desktop/src/renderer/src/ui/itemSubs.ts', root), 'utf8')
    expect(subs).toContain("'drone-launch'")
    expect(subs).toContain("'mod-laser-calibration-2'")
    expect(droneCpuUsed(w.state.fleet[w.uid]!.droneLoad, ctx)).toBe(12)
  })

  it('静态船表仅航母新增特性；旧装备仅巨构代价改5%，其余保持', () => {
    const old = (path: string) => JSON.parse(execFileSync('git', ['show', `26538327:${path}`], { cwd: root, encoding: 'utf8', windowsHide: true }))
    const expectedShips = old('packages/data/src/static/ships.json')
    ;(Object.values(expectedShips.groups).flat().find((ship: any) => ship.id === 'sh-wh-e-carrier') as any).droneLaunchCutPct = .3
    expect(ships).toEqual(expectedShips)
    const expectedModules = old('packages/data/src/static/modules.json')
    ;(Object.values(expectedModules.groups).flat().find((mod: any) => mod.id === 'mod-wh-e-cpu') as any).reloadPenaltyPct = .05
    const oldIds = new Set(Object.values(expectedModules.groups).flat().map((mod: any) => mod.id))
    const copy = structuredClone(modules)
    copy.groups.MODULES_0 = copy.groups.MODULES_0.filter(mod => oldIds.has(mod.id))
    expect(copy).toEqual(expectedModules)
  })

  it('实际舰体特性显示读取30%参数；所有新条目待译登记与中文回退', () => {
    const path = new URL('apps/desktop/src/renderer/src/ui/shipInfo.tsx', root)
    const source = ts.createSourceFile('shipInfo.tsx', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'shipInfoLines')!
    const scope = { exports: {} as { shipInfoLines: (ship: unknown) => Array<{ k: string; v: string }> },
      tr: (id: string, p?: Record<string, unknown>) => l10nEntryText(L10N[id]!, 'zh').replace(/\{(\w+)\}/g, (m,k) => String(p?.[k] ?? m)),
      fmt: String, shipRoleText: () => '', shipCategoryKeyOf: () => '', shipTierText: () => '', DMG_LABEL: {}, shipSlotsOf: (ship: any) => ship.slots,
      pct: (v: number) => `${Math.round(v * 100)}%`, resistsText: () => '', shipCategoryLabelOf: () => '', slotListText: () => '' }
    runInNewContext(ts.transpileModule(fn.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }, fileName: 'shipInfo.tsx' }).outputText, scope)
    expect(scope.exports.shipInfoLines(ctx.ships.get('sh-wh-e-carrier')).some(row => row.v.includes('无人机首次出击等待 −30%'))).toBe(true)
    expect(deferredL10nIssues(L10N, readFileSync(new URL('docs/l10n-pending.md', root), 'utf8'))).toEqual([])
    for (const row of cases) expect(buildSimContext('en').modules.get(row.id)!.name).toBe(ctx.modules.get(row.id)!.name)
  })
})
