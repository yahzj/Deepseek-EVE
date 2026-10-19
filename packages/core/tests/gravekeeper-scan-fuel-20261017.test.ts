import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ANNOUNCEMENTS, buildSimContext, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { activeFoeSpecsOf, createBattleState, createPlayerSpec } from '../src/combat'
import { foeRangeDebuffOf, meJammerNetOf, applyMeJammerDebuff } from '../src/foeRange'
import { matterTechCanResearch, matterTechWhBuffs, researchMatterTech } from '../src/matterTech'
import { wormholeDescend, wormholeEnter, wormholeGridScan, wormholeScanBonusOf } from '../src/wormhole'
import { hexDistance, wormholeMakeGrid } from '../src/wormholeGrid'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { ROOT } from './helpers/save-shell'

const ctx = buildSimContext()
const radiusIds = ['mt-explore-signal-radius-t1', 'mt-explore-signal-radius-t4']

describe('守墓射程压制与舰船参数', () => {
  it('碑卫沿既有乘法压制链，击沉解除；与旧墨潮干扰共同合成', () => {
    const card = ctx.anomalies.get('gravekeeper-line')!
    const foes = activeFoeSpecsOf(card, ctx.balance.battle, 1)
    const bastions = foes.filter(f => f.foeShipId === 'foe-d-invasion-bastion')
    expect(bastions).toHaveLength(2)
    expect(bastions.every(f => f.foeRangeDebuffPct === .15)).toBe(true)
    expect(foeRangeDebuffOf(foes)).toBeCloseTo(.2775, 12)
    const state = createInitialState({ nowWallMs: 0 })
    const me = createPlayerSpec(state, ctx, state.shipId)!
    const battle = createBattleState(me, foes, 0, 3000)
    expect(meJammerNetOf(battle, foes)).toBeCloseTo(.2775, 12)
    const ranged = { ...me, weapons: [{ ...me.weapons[0]!, maxRangeM: 10000 }] }
    expect(applyMeJammerDebuff(ranged, meJammerNetOf(battle, foes)).weapons[0]!.maxRangeM).toBe(7225)
    battle.units[bastions[0]!.tag]!.hp = { s: 0, a: 0, h: 0 }
    expect(meJammerNetOf(battle, foes)).toBeCloseTo(.15, 12)
    battle.units[bastions[0]!.tag]!.hp.h = 1
    expect(meJammerNetOf(battle, foes)).toBeCloseTo(.2775, 12)
    expect(foeRangeDebuffOf([...bastions, { ...bastions[0]!, foeRangeDebuffPct: .5 }])).toBeCloseTo(.63875, 12)
  })

  it.each([['sh-shrike', .24], ['sh-tigershark', .25], ['sh-wh-d-frigate', .209]] as const)('%s基础回避与真实建档均使用新值', (id, evasion) => {
    expect(ctx.ships.get(id)!.evasion).toBe(evasion)
    const state = createInitialState({ nowWallMs: 0 })
    state.shipId = addShipToFleet(state, id)
    expect(createPlayerSpec(state, ctx, state.shipId)!.evasion).toBeCloseTo(evasion, 12)
  })
})

describe('扫描半径两类舰船与单级科技', () => {
  it('所有侦察舰+2，同类不叠加；电子舰+1，同类不叠加；两类相加', () => {
    const scouts = [...ctx.ships.values()].filter(s => s.subClass === '侦察舰')
    const ew = [...ctx.ships.values()].filter(s => s.subClass === '电子舰')
    expect(scouts).toHaveLength(2)
    expect(scouts.every(s => s.wormholeScanRadiusBonus === 2)).toBe(true)
    expect(ew.every(s => s.wormholeScanRadiusBonus === 1)).toBe(true)
    expect(wormholeScanBonusOf(ctx, scouts.map(s => s.id))).toBe(2)
    expect(wormholeScanBonusOf(ctx, ew.map(s => s.id))).toBe(1)
    expect(wormholeScanBonusOf(ctx, [...scouts, ...ew].map(s => s.id))).toBe(3)
    expect(wormholeScanBonusOf(ctx, ['sh-nautilus#1', 'sh-nautilus#2', 'sh-wh-d-frigate#3'])).toBe(3)
  })

  it('价格、前置、一级封顶、扣款及保存重载与科技聚合一致', () => {
    const state = createInitialState({ nowWallMs: 0 })
    state.wallet.isk = 703_000_000
    state.warehouse.items['mat-wh-essence'] = 180
    expect(matterTechCanResearch(state, ctx, radiusIds[1]!).ok).toBe(false)
    expect(researchMatterTech(state, ctx, radiusIds[0]!).ok).toBe(true)
    expect(state.wallet.isk).toBe(700_000_000)
    expect(state.warehouse.items['mat-wh-essence']).toBe(160)
    expect(researchMatterTech(state, ctx, radiusIds[0]!).ok).toBe(false)
    expect(researchMatterTech(state, ctx, radiusIds[1]!).ok).toBe(true)
    expect(state.wallet.isk).toBe(0)
    expect(matterTechWhBuffs(state, ctx).scanRadius).toBe(2)
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    expect(matterTechWhBuffs(loaded, ctx).scanRadius).toBe(2)
  })

  it.each([undefined, 2])('规则%s：进场/深入只存舰船半径，扫描现算科技一次，旧趟研究也立即生效', rules => {
    const state = createInitialState({ nowWallMs: 0, seed: 17 })
    state.shipId = addShipToFleet(state, 'sh-nautilus')
    const ew = addShipToFleet(state, 'sh-wh-d-frigate')
    state.research = { levels: Object.fromEntries(radiusIds.map(id => [id, 1])) }
    expect(wormholeEnter(state, ctx, [state.shipId, ew], 17, rules ? { expeditionRules: rules } : undefined).ok).toBe(true)
    const run = state.wormhole.run!
    expect(run.grid!.scanRadius).toBe(4)
    run.grid = wormholeMakeGrid(17, 15, 3, 1, rules)
    run.grid.scanRadius = 5 // 模拟旧规则已保存的半径，扫描时须按现行编队重算。
    run.depth = 15
    run.grid.pos = { q: 0, r: 0 }
    run.grid.scanned = []
    run.grid.visited = []
    for (const cell of run.grid.cells) { cell.nebula = false; cell.place = 'empty'; cell.foe = undefined }
    expect(wormholeGridScan(state, ctx).ok).toBe(true)
    const scanned = run.grid.cells.filter(c => run.grid!.scanned.includes(c.key))
    const reach = Math.min(6, run.grid.radius)
    expect(Math.max(...scanned.map(c => hexDistance(c, run.grid!.pos)))).toBe(reach)
    expect(scanned).toHaveLength(3 * reach * (reach + 1) + 1)
    run.bossCleared = run.depth
    run.grid.pos = { ...run.grid.exit }
    expect(wormholeDescend(state, 23, wormholeScanBonusOf(ctx, run.fleet), { confirmLeaveCargo: true }).ok).toBe(true)
    expect(run.grid!.scanRadius).toBe(4)
  })
})

type UiNode = { type: string; props: Record<string, any>; children: unknown[] }
function flatten(value: unknown): UiNode[] {
  if (Array.isArray(value)) return value.flatMap(flatten)
  if (!value || typeof value !== 'object' || !('children' in value)) return []
  const node = value as UiNode
  return [node, ...node.children.flatMap(flatten)]
}
function tank(units: number, capacity: number, height: number) {
  const source = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/ui/FuelTank.tsx'), 'utf8')
  const scope = {
    exports: {} as { FuelTank: (p: unknown) => unknown },
    React: { createElement: (type: string, props: object | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
  return flatten(scope.exports.FuelTank({ units, capacity, height, width: 84, label: 'Fuel' }))
}

describe('燃料罐真实SVG几何与公告', () => {
  it.each([140, 320, 600])('高度%s：空罐无液体，四分位/半满/满/超上限液面定位且液体盖到底部', height => {
    for (const cap of [60000, 135000]) for (const ratio of [0, .25, .5, .75, 1, 1.5]) {
      const nodes = tank(cap * ratio, cap, height)
      const wave = nodes.find(n => n.props.className === 'wave-a')
      if (!ratio) { expect(wave).toBeUndefined(); continue }
      const moved = nodes.find(n => n.type === 'g' && n.props.transform)!
      const offset = Number(moved.props.transform.match(/translate\(0 ([^)]+)\)/)[1])
      const innerH = height - 26
      expect(offset).toBeCloseTo(16 + innerH * (1 - Math.min(1, ratio)), 10)
      const d = (wave!.children[0] as UiNode).props.d as string
      expect(d.startsWith('M0 0')).toBe(true)
      const bottom = Number(d.match(/V([\d.]+) H0 Z$/)![1])
      expect(offset + bottom).toBeGreaterThanOrEqual(height - 10)
    }
  })

  it('合并公告按稳定ID保留，允许新公告置前，中英有效且不列敌方数值', () => {
    const index = ANNOUNCEMENTS.findIndex(ann => ann.id === 'ann-signal-beacons-exploration-20261018')
    expect(index).toBeGreaterThanOrEqual(0)
    const ann = ANNOUNCEMENTS[index]!
    expect(ANNOUNCEMENTS[index + 1]!.id).toBe('ann-ship-hp-station-20261013')
    expect(ann.bullets).toHaveLength(5)
    for (const id of [ann.titleId!, ann.tagId!, ...ann.bulletIds!]) {
      expect(L10N[id]!.zh).not.toBe('')
      expect(L10N[id]!.en).not.toBe('')
    }
    expect(ann.bullets.join('')).not.toMatch(/碑卫|永陵|压制挂载|三层血量/)
    expect(ann.bullets.join('')).toContain('回避率')
    expect(ann.bullets.join('')).toContain('满罐')
    expect(ann.bullets.join('')).toContain('40000虚空晶')
    expect(ann.bullets.join('')).toContain('2100')
  })
})
